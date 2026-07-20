import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Supabase client so the api client can read a (fake) session token
// without a real Supabase project.
const getSession = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
    },
  },
}));

import { api, ApiClientError } from './api';

/** Builds a minimal Response-like object covering the fields the client reads. */
function makeResponse(options: {
  status?: number;
  body?: unknown;
  contentType?: string | null;
  statusText?: string;
}): Response {
  const { status = 200, body, contentType = 'application/json', statusText = '' } = options;
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === 'content-type' ? contentType : null,
    },
    text: async () => text,
  } as unknown as Response;
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('parses JSON and attaches the bearer token from the session', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    fetchMock.mockResolvedValue(makeResponse({ body: { ok: true } }));

    const result = await api.get<{ ok: boolean }>('/me');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The client resolves the path against VITE_API_BASE_URL (which may be an
    // absolute origin or a bare "/api"), so assert the endpoint suffix.
    expect(url).toMatch(/\/api\/me$/);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok123');
  });

  it('serialises a JSON body and sets the content-type header', async () => {
    fetchMock.mockResolvedValue(makeResponse({ body: { created: true } }));

    await api.post('/policies', { name: 'plan' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'plan' }));
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('passes FormData through without JSON serialisation', async () => {
    fetchMock.mockResolvedValue(makeResponse({ body: {} }));
    const form = new FormData();
    form.append('file', 'x');

    await api.post('/policies', form);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(form);
    expect((init.headers as Headers).get('Content-Type')).toBeNull();
  });

  it('throws a typed ApiClientError on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        status: 422,
        body: { error: { code: 'validation_error', message: 'Bad input', details: ['name'] } },
      }),
    );

    await expect(api.post('/policies', {})).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      message: 'Bad input',
      details: ['name'],
    });
  });

  it('throws a typed 401 ApiClientError WITHOUT a hard redirect', async () => {
    // The client must not force a full-page navigation on 401 (that logs users
    // out on refresh). Auth routing is handled by AuthContext/RoleRoute instead.
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/app/vault', search: '?q=x', assign },
    });

    try {
      fetchMock.mockResolvedValue(makeResponse({ status: 401, body: undefined }));

      await expect(api.get('/me')).rejects.toMatchObject({
        status: 401,
        code: 'unauthorized',
      });
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('returns undefined for a 204 No Content response', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 204, contentType: null }));

    const result = await api.delete<undefined>('/policies/1');
    expect(result).toBeUndefined();
  });
});
