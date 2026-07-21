// Broker CSV bulk-import controller — HTTP layer for the SAFE import flow.
//
// Thin request/response handlers over {@link ImportService}. Every route is
// guarded upstream by `authMiddleware` + `rbacMiddleware('broker')`, so
// `req.user` is an authenticated broker by the time these run. The broker id is
// resolved via the same profile→broker walk used across the broker portal.
//
// Endpoints (mounted under `/api/broker`):
//   GET  /import/:entity/template  — download a canonical CSV template.
//   POST /import/:entity/preview   — validate a CSV (JSON `{ csv }`), no writes.
//   POST /import/:entity/commit    — re-validate + insert accepted rows.
//
// Safety: preview performs no writes; commit re-validates every row server-side
// against the strict schema; invalid rows are never inserted.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import {
  ImportService,
  buildTemplateCsv,
  type ImportEntity,
} from '../services/broker/importService';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const importService = new ImportService();

/** Narrow the `:entity` route param to a supported import entity, or 400. */
function parseEntity(value: unknown): ImportEntity {
  if (value === 'clients' || value === 'policies') return value;
  throw AppError.badRequest("Unsupported import entity. Use 'clients' or 'policies'.");
}

/**
 * `GET /api/broker/import/:entity/template` — download a canonical CSV template
 * (header row + one example row) as a `text/csv` attachment.
 */
export const downloadTemplate: RequestHandler = (req, res, next) => {
  if (!req.user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  try {
    const entity = parseEntity(req.params.entity);
    const csv = buildTemplateCsv(entity);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-import-template.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    next(err instanceof AppError ? err : AppError.internal('Failed to build template'));
  }
};

/**
 * `POST /api/broker/import/:entity/preview` — validate a CSV without writing.
 * Body: `{ csv: string }`. Returns per-row status + a summary.
 */
export const previewImport: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const csv = (req.body ?? {}).csv;
  if (typeof csv !== 'string') {
    next(AppError.badRequest('Request body must include a `csv` string.'));
    return;
  }

  void (async () => {
    const entity = parseEntity(req.params.entity);
    const brokerId = await importService.resolveBrokerId(user.id);
    const result = await importService.preview(brokerId, entity, csv);
    res.status(200).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to preview import'));
  });
};

/**
 * `POST /api/broker/import/:entity/commit` — re-validate and insert accepted
 * rows. Body: `{ rows: object[] }`. Returns `{ inserted, failed }`.
 */
export const commitImport: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const rows = (req.body ?? {}).rows;
  if (!Array.isArray(rows)) {
    next(AppError.badRequest('Request body must include a `rows` array.'));
    return;
  }

  void (async () => {
    const entity = parseEntity(req.params.entity);
    const brokerId = await importService.resolveBrokerId(user.id);
    const result = await importService.commit(brokerId, entity, rows);
    res.status(200).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to commit import'));
  });
};
