// Central error handling.
//
// Defines a typed `AppError` that carries an HTTP status, a stable machine
// `code`, and optional `details`, plus:
//
//   • `notFound`     — terminal 404 handler for unmatched routes.
//   • `errorHandler` — the central Express error handler that serializes any
//                      thrown error into the shared `ApiError` shape
//                      `{ error: { code, message, details? } }` with the
//                      correct HTTP status (R: design "Error Handling").
//
// Status mapping (per design): 400 validation, 401 auth, 403 rbac, 404,
// 409 conflict, 413 too large, 422 field validation, 429 rate limit, 500.

import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { MulterError } from 'multer';

import type { ApiError } from '@policylens/shared';

import { config } from '../config/index';

/** Stable machine-readable error codes used across the API. */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unprocessable_entity'
  | 'rate_limited'
  | 'internal_error';

/** Default `code` for each HTTP status handled by the API. */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'unprocessable_entity',
  429: 'rate_limited',
  500: 'internal_error',
};

/**
 * An operational error with an attached HTTP status. Throw (or forward via
 * `next`) an `AppError` anywhere in the request lifecycle and the central
 * `errorHandler` will serialize it into the shared `ApiError` shape.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = options?.code ?? CODE_BY_STATUS[status] ?? 'internal_error';
    this.details = options?.details;
    // Restore prototype chain for `instanceof` under transpiled output.
    Object.setPrototypeOf(this, AppError.prototype);
  }

  // Convenience constructors for the statuses used across the API.
  static badRequest(message = 'Bad request', details?: unknown): AppError {
    return new AppError(400, message, { code: 'bad_request', details });
  }
  static unauthorized(message = 'Authentication required', details?: unknown): AppError {
    return new AppError(401, message, { code: 'unauthorized', details });
  }
  static forbidden(message = 'You do not have access to this resource', details?: unknown): AppError {
    return new AppError(403, message, { code: 'forbidden', details });
  }
  static notFound(message = 'Resource not found', details?: unknown): AppError {
    return new AppError(404, message, { code: 'not_found', details });
  }
  static conflict(message = 'Conflict', details?: unknown): AppError {
    return new AppError(409, message, { code: 'conflict', details });
  }
  static payloadTooLarge(message = 'Payload too large', details?: unknown): AppError {
    return new AppError(413, message, { code: 'payload_too_large', details });
  }
  static unprocessable(message = 'Validation failed', details?: unknown): AppError {
    return new AppError(422, message, { code: 'unprocessable_entity', details });
  }
  static rateLimited(message = 'Too many requests', details?: unknown): AppError {
    return new AppError(429, message, { code: 'rate_limited', details });
  }
  static internal(message = 'Internal server error', details?: unknown): AppError {
    return new AppError(500, message, { code: 'internal_error', details });
  }
}

/** Terminal 404 handler for routes that matched no earlier handler. */
export const notFound: RequestHandler = (req: Request, _res: Response, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/**
 * Normalize any thrown value into an `{ status, code, message, details }`
 * quad. Recognizes `AppError`, Multer upload errors, and Express body-parser
 * size errors; everything else becomes a 500 with a generic message.
 */
function normalize(err: unknown): {
  status: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  // Multer surfaces file-size violations and other upload problems.
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        code: 'payload_too_large',
        message: `File exceeds the maximum upload size of ${config.limits.maxUploadMb}MB`,
        details: { field: err.field },
      };
    }
    return {
      status: 400,
      code: 'bad_request',
      message: err.message,
      details: { field: err.field, multerCode: err.code },
    };
  }

  // Express `express.json({ limit })` raises an error with `type` / `status`.
  if (typeof err === 'object' && err !== null) {
    const e = err as { type?: string; status?: number; statusCode?: number; message?: string };
    if (e.type === 'entity.too.large') {
      return { status: 413, code: 'payload_too_large', message: 'Request body too large' };
    }
    const status = e.status ?? e.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return {
        status,
        code: CODE_BY_STATUS[status] ?? 'internal_error',
        message: e.message ?? 'Request failed',
      };
    }
  }

  return { status: 500, code: 'internal_error', message: 'Internal server error' };
}

/**
 * Central Express error handler. Must be registered last (after all routes)
 * and keeps the 4-argument signature Express uses to detect error middleware.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, code, message, details } = normalize(err);

  // Log server-side faults; client (4xx) errors are expected and not noisy.
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  const body: ApiError = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };

  // Guard against attempting to send after headers were already flushed.
  if (res.headersSent) return;
  res.status(status).json(body);
};
