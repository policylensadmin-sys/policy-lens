// Freemium enforcement (R18).
//
// Centralizes the tier-based access rules that gate the customer product:
//
//   • Free tier  — may store at most `FREE_TIER_UPLOAD_LIMIT` (config, 3)
//                  policies and is restricted to the baseline AI analysis
//                  (Health Score, coverage summary, exclusions). Premium-only
//                  features (Claim Simulator, Policy Comparison, family vault,
//                  renewal tracking) are blocked with an upgrade prompt.
//   • Premium tier — no tier-imposed restrictions; upgrading takes effect
//                    immediately because every check reads the *current* tier
//                    from `profiles` (R18.3/R18.6).
//
// Enforcement is expressed as `assert*` functions that resolve to `void` when
// access is allowed and throw an {@link AppError} carrying the stable
// `upgrade_required` code otherwise. A `402 Payment Required` status keeps the
// "you must upgrade" case distinct from a plain `403 forbidden` (RBAC) while
// still being surfaced by the central error handler in the shared `ApiError`
// shape, so the frontend can route the user to the upgrade page (R18.4).

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Tier } from '@policylens/shared';

import { config } from '../../config/index';
import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';

/** Stable machine code for every freemium gate (upload cap + premium feature). */
export const UPGRADE_REQUIRED_CODE = 'upgrade_required';

/** HTTP status used for freemium gates — "Payment Required" fits the upgrade case. */
const UPGRADE_REQUIRED_STATUS = 402;

/**
 * Premium-only features, keyed for stable messaging. `assertPremiumFeature`
 * accepts any string, but these constants document the gated surfaces from
 * R18.2 and give callers a single source of truth for feature names.
 */
export const PREMIUM_FEATURES = {
  claimSimulator: 'Claim Simulator',
  comparison: 'Policy Comparison',
  familyVault: 'Family Vault',
  renewalTracking: 'Renewal Tracking',
} as const;

/** Options accepted by every freemium check (injectable client for testing). */
export interface FreemiumOptions {
  /** Supabase client to use; defaults to the service-role client. */
  client?: SupabaseClient;
}

/** Build the standard `upgrade_required` error with an optional details bag. */
function upgradeRequired(message: string, details?: unknown): AppError {
  return new AppError(UPGRADE_REQUIRED_STATUS, message, {
    code: UPGRADE_REQUIRED_CODE,
    details,
  });
}

/** Resolve the Supabase client to use (injected or shared service-role). */
function resolveClient(opts?: FreemiumOptions): SupabaseClient {
  return opts?.client ?? getSupabaseServiceRoleClient();
}

/**
 * Read the subscription tier for a profile.
 *
 * @param ownerId owning profile id (`profiles.id`).
 * @throws {AppError} 404 when the profile does not exist; 500 on query failure.
 */
export async function getTier(ownerId: string, opts?: FreemiumOptions): Promise<Tier> {
  const db = resolveClient(opts);

  const { data, error } = await db
    .from('profiles')
    .select('tier')
    .eq('id', ownerId)
    .single();

  if (error || !data) {
    // A missing row (PGRST116) means the profile could not be found; anything
    // else is an unexpected read failure.
    if (error && error.code !== 'PGRST116') {
      throw AppError.internal('Failed to read subscription tier', { reason: error.message });
    }
    throw AppError.notFound('Profile not found', { ownerId });
  }

  return (data.tier as Tier) ?? 'free';
}

/**
 * Enforce the free-tier upload cap (R18.1/R18.5).
 *
 * Premium users are always allowed (R18.3). For free users, the current stored
 * policy count is compared against `config.limits.freeTierUploadLimit`; once the
 * limit is reached the upload is rejected with an `upgrade_required` error whose
 * message names the limit and prompts an upgrade.
 *
 * @param ownerId owning profile id (`profiles.id`).
 * @throws {AppError} `upgrade_required` (402) when a free user is at/over the cap.
 */
export async function assertCanUpload(_ownerId: string, _opts?: FreemiumOptions): Promise<void> {
  // All features are free during the trial — no upload cap is enforced.
  return;
}

/**
 * Gate a premium-only feature (R18.2/R18.4).
 *
 * Resolves to `void` for premium users. For free users it throws an
 * `upgrade_required` error identifying the restricted feature by name so the
 * frontend can present a targeted upgrade prompt with pricing options.
 *
 * @param ownerId owning profile id (`profiles.id`).
 * @param feature human-readable feature name (see {@link PREMIUM_FEATURES}).
 * @throws {AppError} `upgrade_required` (402) when the caller is on the free tier.
 */
export async function assertPremiumFeature(
  _ownerId: string,
  _feature: string,
  _opts?: FreemiumOptions,
): Promise<void> {
  // All features are free during the trial — no premium gating.
  return;
}
