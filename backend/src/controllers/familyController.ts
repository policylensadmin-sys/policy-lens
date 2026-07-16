// Family-members controller — HTTP layer for R6.6.
//
// Endpoints:
//   GET  /api/family-members — list the caller's named household members.
//   POST /api/family-members — create a named household member.
//
// Each handler resolves the caller's profile id (the `owner_id` that
// `family_members` / `policies` reference) from their auth user id, then
// delegates to {@link FamilyService}. The service enforces owner-scoping and
// name validation (surfaced as `422`). Errors bubble to the central error
// handler as the shared `{ error: { code, message } }` shape.

import type { RequestHandler } from 'express';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';
import { FamilyService } from '../services/policy/familyService';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const familyService = new FamilyService();

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

/** Read a string field from the request body, or `undefined` when absent. */
function bodyString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `GET /api/family-members` — list the caller's named family members (R6.6).
 * Responds `200` with `{ familyMembers }`.
 */
export const listFamilyMembers: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const familyMembers = await familyService.list(ownerId);
    res.status(200).json({ familyMembers });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list family members'));
  });
};

/**
 * `POST /api/family-members` — create a named family member (R6.6). Requires a
 * non-empty `name`; `relation` is optional. Responds `201` with the created
 * `{ familyMember }`, or `422` when the name is missing/blank.
 */
export const createFamilyMember: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const name = bodyString(req.body?.name);
  if (name === undefined) {
    next(AppError.unprocessable('A family member name is required.', { field: 'name' }));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const familyMember = await familyService.create(ownerId, {
      name,
      relation: bodyString(req.body?.relation),
    });
    res.status(201).json({ familyMember });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to create family member'));
  });
};
