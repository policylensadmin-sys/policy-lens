// Current-user profile route (mounted under `/api`).
//
// GET /api/me — returns the authenticated caller's profile in the shape the
// frontend AuthContext expects: { userId, fullName, email, role, tier, brokerId }.
//
// This route is role-agnostic (both customer and broker use it right after
// sign-in to resolve their role and route to the correct portal), so it applies
// `authMiddleware` only — never `rbacMiddleware`.

import { Router, type RequestHandler } from 'express';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { authMiddleware, AppError } from '../middleware/index';

/** Router carrying the current-user profile endpoint. */
export const meRouter = Router();

const getMe: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Not authenticated'));
    return;
  }

  void (async () => {
    // authMiddleware already resolved role/tier; fetch the display fields.
    const supabase = getSupabaseServiceRoleClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, broker_id')
      .eq('user_id', user.id)
      .maybeSingle();

    res.json({
      userId: user.id,
      fullName: (profile?.full_name as string | null) ?? null,
      email: user.email ?? '',
      role: user.role,
      tier: user.tier,
      brokerId: (profile?.broker_id as string | null) ?? null,
    });
  })().catch((err: unknown) =>
    next(err instanceof AppError ? err : AppError.unauthorized('Failed to load profile')),
  );
};

// GET /api/me — the caller's profile (auth required, any role).
meRouter.get('/me', authMiddleware, getMe);
