import type { ApiError } from '@policylens/shared';
import { supabase } from './supabase';

/**
 * Typed API client for the PolicyLens backend.
 *
 * Responsibilities (R17.1, R17.4):
 * - Prefixes requests with `VITE_API_BASE_URL`.
 * - Attaches `Authorization: Bearer <supabase jwt>` from the current session.
 * - Serialises/parses JSON (and passes `FormData` through untouched for
 *   multipart uploads).
 * - Throws a typed {@link ApiClientError} carrying the backend
 *   `{ error: { code, message, details } }` shape.
 * - Intercepts `401 Unauthorized` responses and redirects the browser to
 *   `/login?redirect=<intended path>` so an expired session lands the user on
 *   the login page (R17.4).
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/**
 * Error thrown for any non-2xx API response. Mirrors the backend error body so
 * callers can branch on a stable `code` and surface `message`/`details`.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Reads the current access token from the Supabase session, if any. */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Redirects to the login page, preserving the path the user was trying to
 * reach so they can be returned there after re-authenticating (R17.4).
 * Guards against a redirect loop when already on the login page.
 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const { pathname, search } = window.location;
  if (pathname === '/login') {
    return;
  }
  const intended = `${pathname}${search}`;
  window.location.assign(`/login?redirect=${encodeURIComponent(intended)}`);
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /**
   * Request body. Plain objects are JSON-serialised; a `FormData` instance is
   * sent as-is (for multipart uploads). Omit for bodyless requests.
   */
  body?: unknown;
  /** Attach the bearer token. Defaults to `true`; set `false` for public routes. */
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  let bodyInit: BodyInit | undefined;

  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      // Let the browser set the multipart boundary Content-Type.
      bodyInit = body;
    } else {
      finalHeaders.set('Content-Type', 'application/json');
      bodyInit = JSON.stringify(body);
    }
  }

  if (auth) {
    const token = await getAccessToken();
    if (token) {
      finalHeaders.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: bodyInit,
  });

  // 401 interceptor: expired/invalid session → send the user to login (R17.4).
  if (response.status === 401) {
    redirectToLogin();
    throw new ApiClientError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
  }

  const payload = await parseBody(response);

  if (!response.ok) {
    const errorBody = payload as ApiError | undefined;
    throw new ApiClientError(
      response.status,
      errorBody?.error?.code ?? 'unknown_error',
      errorBody?.error?.message ?? response.statusText ?? 'Request failed',
      errorBody?.error?.details,
    );
  }

  return payload as T;
}

/** Parses the response body as JSON when present; returns undefined for empty/204. */
async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text) as unknown;
}

/**
 * Convenience methods for the common HTTP verbs. Each returns the parsed JSON
 * body typed as `T`, or throws {@link ApiClientError} on failure.
 */
export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    request<T>(path, { ...options, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),

  /** Escape hatch for full control over the request options. */
  request,
};
