// Broker policy controller — HTTP layer for policies, renewals, premiums (R11).
//
// Thin request/response handlers that resolve the caller's broker id, parse and
// shape query/body input, delegate to {@link BrokerPolicyService}, and return
// JSON. Validation (required fields, end-before-start), status derivation,
// renewal windows, reminder planning, and premium aggregation live in the
// service/logic layers; errors forward to the central error handler as
// `AppError`s (422 for validation failures, 404 for unknown policies, etc.).
//
// The routes are guarded by `authMiddleware` + `rbacMiddleware('broker')`, so
// by the time these handlers run `req.user` is an authenticated broker.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import { BrokerPolicyService } from '../services/broker/policyService';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const policyService = new BrokerPolicyService();

/** Read a single string query param (Express may surface arrays). */
function queryString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0].trim();
  }
  return undefined;
}

/**
 * `GET /api/broker/policies` — paginated list of the broker's policies, ≤50 per
 * page, each with a derived display status (R11.1).
 */
export const listPolicies: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await policyService.resolveBrokerId(user.id);
    const result = await policyService.listPolicies(brokerId, {
      page: queryString(req.query.page),
    });
    res.json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list policies'));
  });
};

/**
 * `POST /api/broker/policies` — add a policy (R11.1). Missing required fields or
 * an end date before the start date return `422` naming the failure (R11.6).
 */
export const createPolicy: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await policyService.resolveBrokerId(user.id);
    const policy = await policyService.createPolicy(brokerId, req.body ?? {});
    res.status(201).json({ policy });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to create policy'));
  });
};

/**
 * `PUT /api/broker/policies/:id` — edit a policy (R11.1). Validation failures in
 * the merged record return `422` (R11.6).
 */
export const updatePolicy: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const policyId = req.params.id;
  if (!policyId) {
    next(AppError.badRequest('A policy id is required'));
    return;
  }

  void (async () => {
    const brokerId = await policyService.resolveBrokerId(user.id);
    const policy = await policyService.updatePolicy(brokerId, policyId, req.body ?? {});
    res.json({ policy });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to update policy'));
  });
};

/**
 * `GET /api/broker/renewals` — renewal calendar: renewals due within 90 days
 * with dates + amounts, each flagged when due within 30 days (R11.2/R11.3).
 */
export const getRenewalCalendar: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await policyService.resolveBrokerId(user.id);
    const calendar = await policyService.getRenewalCalendar(brokerId);
    res.json(calendar);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load renewal calendar'));
  });
};

/**
 * `POST /api/broker/renewals/remind` — send renewal reminders for the selected
 * window and return the confirmation count plus failed recipients (R11.5/R11.7).
 */
export const sendRenewalReminders: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await policyService.resolveBrokerId(user.id);
    const body = (req.body ?? {}) as { withinDays?: unknown };
    const summary = await policyService.sendRenewalReminders(brokerId, {
      withinDays: body.withinDays,
    });
    res.json(summary);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to send renewal reminders'));
  });
};

/**
 * `GET /api/broker/premiums` — premium tracker: collection status
 * (Paid/Pending/Overdue) with a trailing-12-month chart by insurance type
 * (R11.4).
 */
export const getPremiumTracker: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await policyService.resolveBrokerId(user.id);
    const tracker = await policyService.getPremiumTracker(brokerId);
    res.json(tracker);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load premium tracker'));
  });
};
