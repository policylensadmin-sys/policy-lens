// Authentication middleware.
//
// Verifies the Supabase-issued JWT presented via `Authorization: Bearer <jwt>`,
// then loads the user's role/tier from the `profiles` table and attaches an
// `AuthenticatedUser` to `req.user` for downstream RBAC and controllers
// (R17.1). Any failure (missing header, invalid/expired token, missing
// profile) results in a `401` via the central error handler.

import type { RequestHandler } from 'express';

import type { Role, Tier } from '@policylens/shared';
import { ROLES, TIERS } from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import type { AuthenticatedUser } from '../types/express';
import { AppError } from './errorHandler';

/** Extract a bearer token from the `Authorization` header, if well-formed. */
function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

/** Narrow an arbitrary DB value to a known `Role`, defaulting to `customer`. */
function toRole(value: unknown): Role {
  return (ROLES as readonly string[]).includes(value as string) ? (value as Role) : 'customer';
}

/** Narrow an arbitrary DB value to a known `Tier`, defaulting to `free`. */
function toTier(value: unknown): Tier {
  return (TIERS as readonly string[]).includes(value as string) ? (value as Tier) : 'free';
}

/**
 * Authenticate the request. Verifies the JWT with Supabase (`auth.getUser`),
 * loads the caller's profile, and attaches `req.user`. Forwards a `401`
 * `AppError` on any failure.
 */
export const authMiddleware: RequestHandler = (req, _res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    next(AppError.unauthorized('Missing or malformed Authorization header'));
    return;
  }

  // Wrap the async work so any rejection is funneled to the error handler.
  void (async () => {
    let supabase;
    try {
      supabase = getSupabaseServiceRoleClient();
    } catch {
      // Credentials not configured — treat as an auth failure rather than 500.
      next(AppError.unauthorized('Authentication is not available'));
      return;
    }

    // Verify the token and resolve the auth user.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const authUser = userData?.user;
    if (userError || !authUser) {
      next(AppError.unauthorized('Invalid or expired session'));
      return;
    }

    // Load role/tier from the profile (service-role bypasses RLS).
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, tier, email')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profileError || !profile) {
      next(AppError.unauthorized('No profile found for the authenticated user'));
      return;
    }

    const user: AuthenticatedUser = {
      id: authUser.id,
      email: authUser.email ?? (profile.email as string | undefined),
      role: toRole(profile.role),
      tier: toTier(profile.tier),
    };

    req.user = user;
    next();
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.unauthorized('Authentication failed'));
  });
};
