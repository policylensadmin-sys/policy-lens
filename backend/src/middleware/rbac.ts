// Role-based access control middleware.
//
// `rbacMiddleware(...roles)` guards a route so that only authenticated users
// whose profile `role` is in the allowed list may proceed. Cross-portal access
// (e.g. a customer hitting `/broker/*`) is denied with `403` + a clear message
// (R17.2, R17.5). Must run after `authMiddleware`, which populates `req.user`.

import type { RequestHandler } from 'express';

import type { Role } from '@policylens/shared';

import { AppError } from './errorHandler';

/**
 * Build a middleware that permits only the given roles. If the request is not
 * authenticated it fails with `401`; if the authenticated role is not allowed
 * it fails with `403` and a message naming the required role(s).
 */
export function rbacMiddleware(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) {
      // Defensive: RBAC should always follow authentication.
      next(AppError.unauthorized('Authentication required'));
      return;
    }

    if (!allowed.includes(user.role)) {
      next(
        AppError.forbidden(
          `Access denied: this resource requires the ${allowed.join(' or ')} role`,
          { requiredRoles: allowed, actualRole: user.role },
        ),
      );
      return;
    }

    next();
  };
}
