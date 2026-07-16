// Policy controller — HTTP layer for customer policy endpoints.
//
// Currently exposes the upload handler for `POST /api/policies` (R1/R16/R21):
// it resolves the caller's profile id (the `owner_id` that `policies`/`jobs`
// reference), then delegates to {@link PolicyService.createFromUpload} to store
// the file, create the policy row, and enqueue the analysis job. The stored
// document + queued job acknowledgment is returned as `201 Created`.
//
// The multipart parsing, MIME/size validation, and content sniffing are handled
// by the upload middleware chain mounted on the route; by the time this handler
// runs, `req.file` is a validated PDF/JPEG/PNG buffer.

import type { RequestHandler } from 'express';

import type { PolicyCategory } from '@policylens/shared';
import { POLICY_CATEGORIES } from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';
import { PolicyService } from '../services/policy/policyService';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const policyService = new PolicyService();

/** Narrow an arbitrary body value to a known category, or `undefined`. */
function toCategory(value: unknown): PolicyCategory | undefined {
  return (POLICY_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as PolicyCategory)
    : undefined;
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

/**
 * `POST /api/policies` — accept a multipart upload, store it, and enqueue the
 * analysis job. Responds `201` with `{ policy, job }` (R1.1–R1.3, R16.1).
 */
export const uploadPolicy: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const file = req.file;
  if (!file) {
    next(AppError.badRequest('No file provided'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);

    const result = await policyService.createFromUpload({
      ownerId,
      file: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      category: toCategory(req.body?.category),
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
    });

    res.status(201).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to process upload'));
  });
};

/** Read the first non-empty string value of a query param (ignores arrays). */
function queryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * `GET /api/policies` — list the caller's vault, filtered by `q`, `category`,
 * and `member` query params (R6.3/R6.6). Responds `200` with `{ policies }`.
 */
export const listPolicies: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const policies = await policyService.listForOwner(ownerId, {
      q: queryString(req.query.q),
      category: toCategory(queryString(req.query.category)),
      memberId: queryString(req.query.member),
    });
    res.status(200).json({ policies });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list policies'));
  });
};

/**
 * `GET /api/policies/:id` — dashboard payload (policy + analysis + derived
 * view-model fields) for a single owned policy (R4). Responds `200`.
 */
export const getPolicyDashboard: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const id = req.params.id;
  if (!id) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const dashboard = await policyService.getDashboard(ownerId, id);
    res.status(200).json(dashboard);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load policy'));
  });
};

/**
 * `GET /api/policies/:id/download` — mint a short-lived signed URL for the
 * original document (R6.4/R21.3). Responds `200` with `{ url, expiresAt }`.
 */
export const downloadPolicy: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const id = req.params.id;
  if (!id) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const download = await policyService.getDownloadUrl(ownerId, id);
    res.status(200).json(download);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to prepare download'));
  });
};

/**
 * `DELETE /api/policies/:id` — delete an owned policy and cascade-remove its
 * analysis, embeddings, extracted text, and stored document (R6.5). Responds
 * `204 No Content`.
 */
export const deletePolicy: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const id = req.params.id;
  if (!id) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    await policyService.deletePolicy(ownerId, id);
    res.status(204).end();
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to delete policy'));
  });
};

/**
 * `GET /api/jobs/:id` — processing job status/progress for the poller (R16.2).
 * Responds `200` with the job status view.
 */
export const getJobStatus: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const id = req.params.id;
  if (!id) {
    next(AppError.badRequest('Missing job id'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const job = await policyService.getJob(ownerId, id);
    res.status(200).json(job);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load job'));
  });
};
