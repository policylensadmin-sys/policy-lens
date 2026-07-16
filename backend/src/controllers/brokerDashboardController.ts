// Broker dashboard controller — HTTP layer for `GET /api/broker/dashboard` (R9, R13).
//
// Thin handler that resolves the caller's profile id (the dashboard service
// scopes by `brokers.profile_id`) and delegates aggregation to
// {@link BrokerDashboardService}. Guarded upstream by `authMiddleware` +
// `rbacMiddleware('broker')`, so `req.user` is an authenticated broker.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { BrokerDashboardService } from '../services/broker/brokerDashboardService';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const dashboardService = new BrokerDashboardService();

/** Resolve the caller's `profiles.id` from their auth user id, or throw 403. */
async function resolveProfileId(userId: string): Promise<string> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.id) {
    throw AppError.forbidden('No broker profile found for the authenticated user');
  }
  return data.id as string;
}

/**
 * `GET /api/broker/dashboard` — aggregated KPIs, premium collection, commission
 * overview, and recent AI insights for the authenticated broker (R9, R13).
 */
export const getBrokerDashboard: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const profileId = await resolveProfileId(user.id);
    const dashboard = await dashboardService.getDashboard(profileId);
    res.json(dashboard);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load broker dashboard'));
  });
};
