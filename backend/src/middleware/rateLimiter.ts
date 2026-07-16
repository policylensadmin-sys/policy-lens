// Rate limiting middleware.
//
// Protects expensive / abuse-prone endpoints (AI calls, uploads, and the
// unauthenticated guest preview) from bursts. Limits are keyed by the
// authenticated user id when available, otherwise by client IP. On breach the
// request is funneled through the central error handler as a typed `429`
// (design: "Security Considerations" — rate limiting on AI/upload endpoints).

import rateLimit, { type Options } from 'express-rate-limit';

import { AppError } from './errorHandler';

/** Key by authenticated user id when present, else fall back to client IP. */
function keyGenerator(req: Parameters<Options['keyGenerator']>[0]): string {
  return req.user?.id ?? req.ip ?? 'unknown';
}

/** Shared options: emit a typed 429 via the error handler, key per user/IP. */
function baseOptions(windowMs: number, max: number): Partial<Options> {
  return {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (_req, _res, next) => {
      next(AppError.rateLimited('Too many requests, please try again later'));
    },
  };
}

/**
 * Build a rate limiter with a custom window / max. Useful for tuning specific
 * routes (e.g. tighter limits on the public guest preview).
 */
export function createRateLimiter(windowMs: number, max: number) {
  return rateLimit(baseOptions(windowMs, max));
}

/** Default limiter for AI / upload endpoints: 30 requests per minute. */
export const aiRateLimiter = createRateLimiter(60_000, 30);

/** Tighter limiter for the unauthenticated guest preview: 5 requests per hour. */
export const guestRateLimiter = createRateLimiter(60 * 60_000, 5);
