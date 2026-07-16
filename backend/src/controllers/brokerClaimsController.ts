// Broker claims controller — HTTP layer for claims + commission (R9.3, R12).
//
// Thin request/response handlers that resolve the caller's broker id, parse and
// shape query/body input, delegate to {@link ClaimsService}, and return JSON.
// Pagination, filtering, Claim Assistant validation, status-change
// notifications, and commission aggregation live in the service/logic layers;
// errors forward to the central error handler as `AppError`s (422 for missing
// required claim information, 404 for unknown claims, etc.).
//
// The routes are guarded by `authMiddleware` + `rbacMiddleware('broker')`, so
// by the time these handlers run `req.user` is an authenticated broker.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import { ClaimsService } from '../services/broker/claimsService';
import { toClaimStatus, type ClaimFilters } from '../services/broker/claimsLogic';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const claimsService = new ClaimsService();

/** Read a single string query param (Express may surface arrays). */
function queryString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0].trim();
  }
  return undefined;
}

/**
 * `GET /api/broker/claims` — paginated list of the broker's claims (≤50/page),
 * filterable by status, client, policy type, and submission date range. Returns
 * an empty list (with a `noResults` flag) when nothing matches (R12.1/R12.3).
 */
export const listClaims: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await claimsService.resolveBrokerId(user.id);

    const filters: ClaimFilters & { page?: string } = {
      status: toClaimStatus(queryString(req.query.status)),
      clientId: queryString(req.query.clientId) ?? queryString(req.query.client),
      policyType: queryString(req.query.policyType) ?? queryString(req.query.type),
      from: queryString(req.query.from),
      to: queryString(req.query.to),
      page: queryString(req.query.page),
    };

    const result = await claimsService.listClaims(brokerId, filters);
    res.json({ ...result, noResults: result.totalCount === 0 });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list claims'));
  });
};

/**
 * `POST /api/broker/claims` — submit a claim on behalf of a client via the
 * Claim Assistant (R12.4). Missing required information returns `422` naming the
 * fields, preventing submission (R12.5).
 */
export const submitClaim: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await claimsService.resolveBrokerId(user.id);
    const claim = await claimsService.submitClaimViaAssistant(brokerId, req.body ?? {});
    res.status(201).json({ claim });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to submit claim'));
  });
};

/**
 * `PUT /api/broker/claims/:id/status` — update a claim's status and notify the
 * broker of the change (R12.2). An unknown status returns `400`; an unknown
 * claim returns `404`.
 */
export const updateClaimStatus: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const claimId = req.params.id;
  if (!claimId) {
    next(AppError.badRequest('A claim id is required'));
    return;
  }

  const body = (req.body ?? {}) as { status?: unknown };
  const status = toClaimStatus(body.status);
  if (!status) {
    next(AppError.badRequest('A valid claim status is required'));
    return;
  }

  void (async () => {
    const brokerId = await claimsService.resolveBrokerId(user.id);
    const claim = await claimsService.updateClaimStatus(brokerId, claimId, status);
    res.json({ claim });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to update claim status'));
  });
};

/**
 * `GET /api/broker/commission` — commission overview: total / paid / pending /
 * overdue amounts to 2 decimals in the broker's configured currency (R9.3).
 */
export const getCommissionOverview: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await claimsService.resolveBrokerId(user.id);
    const commission = await claimsService.getCommissionOverview(brokerId);
    res.json({ commission });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load commission overview'));
  });
};
