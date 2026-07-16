// Broker insights controller — HTTP layer for AI insights + reports/analytics
// (R13, R19.7).
//
// Thin request/response handlers that resolve the caller's broker id, delegate
// to {@link InsightsService}, and return JSON. Portfolio analysis, the 24-hour
// refresh policy, coverage-gap augmentation, the insufficient-data/service
// fallback, and the report/analytics aggregations all live in the service
// layer; errors forward to the central error handler as `AppError`s.
//
// The routes are guarded by `authMiddleware` + `rbacMiddleware('broker')`, so
// by the time these handlers run `req.user` is an authenticated broker.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import { InsightsService } from '../services/broker/insightsService';

/** Shared service instance (lazily resolves its Supabase + AI clients). */
const insightsService = new InsightsService();

/**
 * `GET /api/broker/insights` — categorized AI insights for the broker's
 * portfolio, refreshed at least every 24 hours (R13.1–R13.4). When insights
 * cannot be generated (insufficient data or service unavailable), returns a
 * fallback with `available: false` and the last-generated timestamp (R13.5).
 */
export const getInsights: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await insightsService.resolveBrokerId(user.id);
    const result = await insightsService.getInsights(brokerId);
    res.json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load AI insights'));
  });
};

/**
 * `GET /api/broker/reports` — aggregated reports covering policy volume,
 * premium revenue, claims activity, and commission earned (R19.7).
 */
export const getReports: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await insightsService.resolveBrokerId(user.id);
    const reports = await insightsService.getReports(brokerId);
    res.json(reports);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load reports'));
  });
};

/**
 * `GET /api/broker/analytics` — analytics view with a 12-month premium trend,
 * policy mix, claims breakdown, and commission overview (R19.7).
 */
export const getAnalytics: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await insightsService.resolveBrokerId(user.id);
    const analytics = await insightsService.getAnalytics(brokerId);
    res.json(analytics);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load analytics'));
  });
};
