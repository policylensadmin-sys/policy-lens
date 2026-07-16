// Compare & Claim-Simulator controller — HTTP layer for R7 and R8.
//
// Endpoints:
//   POST /api/compare                    — compare two owned policies (R7).
//   POST /api/policies/:id/claim-sim     — simulate a claim scenario (R8).
//
// Each handler resolves the caller's profile id (the `owner_id` that domain
// rows reference) from their auth user id, then delegates to the relevant
// service, which enforces ownership, premium gating (R18.2), the analysis-ready
// checks (R7.5 / R8), and the insufficient-detail / not-covered messaging
// (R8.6 / R8.7). Errors bubble to the central error handler as the shared
// `{ error: { code, message } }` shape.

import type { RequestHandler } from 'express';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';
import { createAiProviders } from '../services/ai/factory';
import { ClaimSimService } from '../services/policy/claimSimService';
import { CompareService } from '../services/policy/compareService';

/**
 * Build the shared services lazily on first use. Provider resolution (and any
 * Supabase client creation) is deferred so importing this module does not
 * require credentials in mock/dev mode.
 */
let compareServiceSingleton: CompareService | undefined;
function compareService(): CompareService {
  if (!compareServiceSingleton) {
    const { ai } = createAiProviders({ silent: true });
    compareServiceSingleton = new CompareService(ai);
  }
  return compareServiceSingleton;
}

let claimSimServiceSingleton: ClaimSimService | undefined;
function claimSimService(): ClaimSimService {
  if (!claimSimServiceSingleton) {
    const { ai } = createAiProviders({ silent: true });
    claimSimServiceSingleton = new ClaimSimService(ai);
  }
  return claimSimServiceSingleton;
}

/**
 * Resolve the caller's profile id (`profiles.id`) from their auth user id
 * (`profiles.user_id`). Domain rows scope ownership by profile id, whereas
 * `req.user.id` is the Supabase auth user id.
 */
async function resolveProfileId(userId: string): Promise<string> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.id) {
    throw AppError.unauthorized('No profile found for the authenticated user');
  }
  return data.id as string;
}

/** Read a required string field from the request body, or `undefined`. */
function bodyString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `POST /api/compare` — compare two owned policies and return a structured A/B
 * comparison with a Health-Score-based recommendation (R7). Responds `200` with
 * the {@link CompareResult}. Rejects free-tier callers (R18.2) and policies
 * without completed analysis (R7.5).
 */
export const comparePolicies: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const policyAId = bodyString(req.body?.policyAId);
  const policyBId = bodyString(req.body?.policyBId);
  if (!policyAId || !policyBId) {
    next(AppError.badRequest('Two policy ids (policyAId, policyBId) are required.'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const result = await compareService().compare(ownerId, policyAId, policyBId);
    res.status(200).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to compare policies'));
  });
};

/**
 * `POST /api/policies/:id/claim-sim` — evaluate a plain-language claim scenario
 * against the policy (R8). Responds `200` with the {@link ClaimSimulationResult}
 * (probability, checks, reasons, matched exclusion, and insufficient-detail /
 * not-covered flags). Rejects free-tier callers (R18.2).
 */
export const simulateClaim: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const policyId = req.params.id;
  if (!policyId) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }

  const scenario = bodyString(req.body?.scenario);
  if (scenario === undefined) {
    next(AppError.badRequest('A claim scenario is required.'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const result = await claimSimService().simulate(ownerId, policyId, scenario);
    res.status(200).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to simulate the claim'));
  });
};
