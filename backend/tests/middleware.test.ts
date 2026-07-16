import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';

import {
  AppError,
  errorHandler,
  rbacMiddleware,
  sniffFileType,
} from '../src/middleware/index';
import type { AuthenticatedUser } from '../src/types/express';

// ---------------------------------------------------------------------------
// Fakes: plain Express req/res/next doubles. No real server or Supabase.
// ---------------------------------------------------------------------------

/** A fake `next` that records whether it was called and with what argument. */
function makeNext(): NextFunction & { calledWith: unknown; called: boolean } {
  const fn = vi.fn();
  Object.defineProperty(fn, 'called', {
    get(): boolean {
      return fn.mock.calls.length > 0;
    },
  });
  Object.defineProperty(fn, 'calledWith', {
    get(): unknown {
      return fn.mock.calls[0]?.[0];
    },
  });
  return fn as unknown as NextFunction & { calledWith: unknown; called: boolean };
}

/** A fake `Response` capturing `status()`/`json()` and `headersSent`. */
function makeRes(headersSent = false): Response & {
  statusCode?: number;
  body?: unknown;
} {
  const res = {
    headersSent,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

function makeUser(role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id: 'u1', email: 'u1@example.com', role, tier: 'free' };
}

// ---------------------------------------------------------------------------
// rbacMiddleware — R1.4, R1.5, R17.2, R17.5
// ---------------------------------------------------------------------------

describe('rbacMiddleware', () => {
  it('allows when the user role is in the allowed list (next with no error)', () => {
    const req = { user: makeUser('broker') } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    rbacMiddleware('broker')(req, res, next);

    expect(next.called).toBe(true);
    // next() called with no argument means "proceed".
    expect(next.calledWith).toBeUndefined();
  });

  it('allows when the user role is one of several allowed roles', () => {
    const req = { user: makeUser('corporate') } as unknown as Request;
    const next = makeNext();

    rbacMiddleware('broker', 'corporate')(req, makeRes(), next);

    expect(next.calledWith).toBeUndefined();
  });

  it('denies with a 403 forbidden AppError when the role is not allowed', () => {
    const req = { user: makeUser('customer') } as unknown as Request;
    const next = makeNext();

    rbacMiddleware('broker')(req, makeRes(), next);

    const err = next.calledWith;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(403);
    expect((err as AppError).code).toBe('forbidden');
  });

  it('returns 401 when there is no authenticated user', () => {
    const req = {} as unknown as Request;
    const next = makeNext();

    rbacMiddleware('broker')(req, makeRes(), next);

    const err = next.calledWith;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(401);
    expect((err as AppError).code).toBe('unauthorized');
  });
});

// ---------------------------------------------------------------------------
// errorHandler — R17.2, R17.5 (shared body shape + status mapping)
// ---------------------------------------------------------------------------

describe('errorHandler', () => {
  it('maps an AppError to the correct status and shared body shape', () => {
    const res = makeRes();
    const err = AppError.forbidden('nope', { reason: 'x' });

    errorHandler(err, {} as Request, res, makeNext());

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'forbidden',
        message: 'nope',
        details: { reason: 'x' },
      },
    });
  });

  it('omits details from the body when the AppError has none', () => {
    const res = makeRes();

    errorHandler(AppError.badRequest('bad'), {} as Request, res, makeNext());

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: { code: 'bad_request', message: 'bad' } });
  });

  it('maps a Multer LIMIT_FILE_SIZE error to 413 payload_too_large', () => {
    const res = makeRes();
    const err = new MulterError('LIMIT_FILE_SIZE', 'file');

    errorHandler(err, {} as Request, res, makeNext());

    expect(res.statusCode).toBe(413);
    expect((res.body as { error: { code: string } }).error.code).toBe('payload_too_large');
  });

  it('maps an unknown error to a generic 500', () => {
    const res = makeRes();

    errorHandler(new Error('boom'), {} as Request, res, makeNext());

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });

  it('does not attempt to send when headers are already sent', () => {
    const res = makeRes(true);

    errorHandler(AppError.badRequest('bad'), {} as Request, res, makeNext());

    expect(res.statusCode).toBeUndefined();
    expect(res.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// upload sniffFileType — R1.4, R1.5 (content sniff in isolation)
// ---------------------------------------------------------------------------

describe('upload sniffFileType', () => {
  it('passes a PDF whose magic bytes match its declared MIME type', () => {
    const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
    const req = {
      file: { buffer, mimetype: 'application/pdf', originalname: 'policy.pdf' },
    } as unknown as Request;
    const next = makeNext();

    sniffFileType(req, makeRes(), next);

    expect(next.calledWith).toBeUndefined();
  });

  it('rejects a text buffer with wrong magic bytes as a 400 bad_request', () => {
    const buffer = Buffer.from('this is plain text, not a real pdf', 'utf8');
    const req = {
      file: { buffer, mimetype: 'application/pdf', originalname: 'fake.pdf' },
    } as unknown as Request;
    const next = makeNext();

    sniffFileType(req, makeRes(), next);

    const err = next.calledWith;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
    expect((err as AppError).code).toBe('bad_request');
  });

  it('rejects when the sniffed content type does not match the declared MIME', () => {
    // A real PNG buffer but declared as a PDF — spoofed MIME.
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const req = {
      file: { buffer, mimetype: 'application/pdf', originalname: 'spoof.pdf' },
    } as unknown as Request;
    const next = makeNext();

    sniffFileType(req, makeRes(), next);

    const err = next.calledWith;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
  });

  it('rejects with 400 when no file is present', () => {
    const req = {} as unknown as Request;
    const next = makeNext();

    sniffFileType(req, makeRes(), next);

    const err = next.calledWith;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
  });
});
