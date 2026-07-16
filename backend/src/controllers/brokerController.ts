// Broker controller — HTTP layer for the broker client endpoints (R10).
//
// Thin request/response handlers that resolve the caller's broker id, parse and
// shape query/body input, delegate to {@link ClientService}, and return JSON.
// Validation, risk categorization, and filtering live in the service/logic
// layers; errors are forwarded to the central error handler as `AppError`s
// (422 for missing required fields, 404 for unknown clients, etc.).
//
// The routes are guarded by `authMiddleware` + `rbacMiddleware('broker')`, so
// by the time these handlers run `req.user` is an authenticated broker.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import { ClientService } from '../services/broker/clientService';
import { toRiskCategory, type ClientFilters } from '../services/broker/clientLogic';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const clientService = new ClientService();

/** Read a single string query param (Express may surface arrays). */
function queryString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0].trim();
  }
  return undefined;
}

/** Parse a non-negative integer query param, or `undefined`. */
function queryNonNegativeInt(value: unknown): number | undefined {
  const str = queryString(value);
  if (str === undefined) return undefined;
  const parsed = Number(str);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Resolve the broker id for the current request, or throw a typed error. */
async function requireBrokerId(userId: string): Promise<string> {
  return clientService.resolveBrokerId(userId);
}

/**
 * `GET /api/broker/clients` — search/filter the broker's clients by name,
 * policy type, risk status, and renewal window (R10.1/R10.4).
 */
export const listClients: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await requireBrokerId(user.id);

    const filters: ClientFilters = {
      name: queryString(req.query.name) ?? queryString(req.query.q),
      policyType: queryString(req.query.type) ?? queryString(req.query.policyType),
      risk: toRiskCategory(queryString(req.query.risk)),
      renewalWithinDays:
        queryNonNegativeInt(req.query.renewalWithinDays) ??
        queryNonNegativeInt(req.query.renewal),
    };

    const clients = await clientService.listClients(brokerId, filters);
    res.json({ clients });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list clients'));
  });
};

/**
 * `GET /api/broker/clients/risk` — Client Risk Dashboard counts (R10.3).
 * Registered before `/:id` so `risk` is not treated as a client id.
 */
export const getClientRiskDashboard: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await requireBrokerId(user.id);
    const counts = await clientService.getRiskDashboard(brokerId);
    res.json({ counts });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load risk dashboard'));
  });
};

/**
 * `GET /api/broker/clients/:id` — full client profile: details, associated
 * policies, and derived coverage gaps (R10.2).
 */
export const getClient: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const clientId = req.params.id;
  if (!clientId) {
    next(AppError.badRequest('A client id is required'));
    return;
  }

  void (async () => {
    const brokerId = await requireBrokerId(user.id);
    const client = await clientService.getClientProfile(brokerId, clientId);
    res.json({ client });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load client'));
  });
};

/**
 * `POST /api/broker/clients` — add a client with at least one associated policy
 * (R10.1). Missing required fields return `422` naming the fields (R10.5).
 */
export const createClient: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await requireBrokerId(user.id);
    const client = await clientService.createClient(brokerId, req.body ?? {});
    res.status(201).json({ client });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to create client'));
  });
};

/**
 * `PUT /api/broker/clients/:id` — edit a client's core fields (R10.1). Missing
 * required fields in the merged record return `422` (R10.5).
 */
export const updateClient: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const clientId = req.params.id;
  if (!clientId) {
    next(AppError.badRequest('A client id is required'));
    return;
  }

  void (async () => {
    const brokerId = await requireBrokerId(user.id);
    const client = await clientService.updateClient(brokerId, clientId, req.body ?? {});
    res.json({ client });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to update client'));
  });
};
