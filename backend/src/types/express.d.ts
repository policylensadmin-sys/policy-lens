// Express type augmentation.
//
// Extends the Express `Request` with the authenticated user attached by
// `authMiddleware`. Declaration merging keeps `req.user` strongly typed across
// controllers and middleware without importing a custom request type.

import type { Role, Tier } from '@policylens/shared';

/** The authenticated principal attached to a request after `authMiddleware`. */
export interface AuthenticatedUser {
  /** Supabase auth user id (`auth.users.id`). */
  id: string;
  /** User email, when present on the verified token / profile. */
  email?: string;
  /** Role from the user's profile — drives RBAC (R17.2/R17.5). */
  role: Role;
  /** Subscription tier from the user's profile — gates freemium (R18). */
  tier: Tier;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `authMiddleware` on authenticated routes. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
