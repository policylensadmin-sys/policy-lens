// Middleware — public surface.
//
// Central export point for the Express middleware layer: authentication, RBAC,
// uploads, rate limiting, and error handling.

export { AppError, errorHandler, notFound, type ErrorCode } from './errorHandler';
export { authMiddleware } from './auth';
export { rbacMiddleware } from './rbac';
export { uploadMiddleware, uploadSingle, sniffFileType } from './upload';
export { aiRateLimiter, guestRateLimiter, createRateLimiter } from './rateLimiter';
export type { AuthenticatedUser } from '../types/express';
