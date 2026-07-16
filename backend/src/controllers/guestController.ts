// Guest controller — HTTP layer for the unauthenticated landing-page preview.
//
// Exposes `analyzeGuest` for `POST /api/try/analyze` (R17.3, R20.7): an
// unauthenticated visitor can upload a single policy document and get a quick,
// ephemeral preview of the analysis without creating an account.
//
// This flow is deliberately NON-PERSISTED: nothing is written to the database
// or object storage. The uploaded buffer is parsed to text and analyzed in
// memory, then a simplified subset of the analysis is returned and the buffer
// is discarded when the request ends. Providers come from the AI factory, which
// defaults to the deterministic mock adapter (Demo/Mock mode) when no live keys
// are configured, so the preview works out of the box.
//
// The multipart parsing, MIME/size validation, and content sniffing are handled
// by the upload middleware chain mounted on the route, and abuse is bounded by
// the tighter guest rate limiter — so by the time this handler runs, `req.file`
// is a validated PDF/JPEG/PNG buffer.

import type { RequestHandler } from 'express';

import type { Exclusion, HiddenClause, PolicyAnalysis } from '@policylens/shared';

import { AppError } from '../middleware/errorHandler';
import { createAiProviders } from '../services/ai/index';
import { AnalysisService } from '../services/policy/analysis';
import { ParserError, ParserService } from '../services/policy/parser';

/** How many exclusions / risk flags the preview surfaces (kept intentionally small). */
const PREVIEW_EXCLUSION_LIMIT = 3;
const PREVIEW_RISK_FLAG_LIMIT = 3;

/**
 * Providers for the guest flow. Built once and reused across requests; defaults
 * to the deterministic mock adapters when live keys are absent (Demo/Mock mode).
 * The banner is suppressed here since the startup banner is logged on boot.
 */
const providers = createAiProviders({ silent: true });
const parserService = new ParserService(providers.ocr);
const analysisService = new AnalysisService(providers.ai);

/** Shape of the trimmed analysis returned to unauthenticated visitors. */
interface GuestPreview {
  /** Marks this as the reduced, non-persisted guest response. */
  preview: true;
  /** Deterministic 0–100 policy Health Score. */
  healthScore: number | null;
  /** Number of High/Medium hidden clauses flagged as risks. */
  riskFlagCount: number;
  /** Detected insurer/provider name (or "Unknown" on a partial result). */
  provider: string;
  /** A few of the policy's exclusions. */
  topExclusions: Exclusion[];
  /** A few High/Medium risk flags drawn from the hidden clauses. */
  riskFlags: HiddenClause[];
  /** True when the analysis could only be partially produced (R3.10). */
  partial: boolean;
}

/** Reduce a full analysis down to the preview subset shown on the landing page. */
function toPreview(analysis: PolicyAnalysis): GuestPreview {
  const riskFlags = analysis.hiddenClauses.filter(
    (c) => c.risk === 'High' || c.risk === 'Medium',
  );

  return {
    preview: true,
    healthScore: analysis.healthScore ?? null,
    riskFlagCount: analysis.riskFlagCount ?? riskFlags.length,
    provider: analysis.provider,
    topExclusions: analysis.exclusions.slice(0, PREVIEW_EXCLUSION_LIMIT),
    riskFlags: riskFlags.slice(0, PREVIEW_RISK_FLAG_LIMIT),
    partial: analysis.partial,
  };
}

/**
 * `POST /api/try/analyze` — unauthenticated single-policy preview (R17.3, R20.7).
 *
 * Runs text extraction then analysis entirely in memory and returns a trimmed
 * preview. Nothing is persisted. Parser failures (unsupported type, unreadable
 * scan, OCR unavailable, empty document) are surfaced with their user-facing
 * message and an appropriate status; other failures degrade to a generic 500.
 */
export const analyzeGuest: RequestHandler = (req, res, next) => {
  const file = req.file;
  if (!file) {
    next(AppError.badRequest('No file provided'));
    return;
  }

  void (async () => {
    const extracted = await parserService.extract(file.buffer, file.mimetype);
    const analysis = await analysisService.analyze(extracted.text);
    res.status(200).json(toPreview(analysis));
  })().catch((err: unknown) => {
    next(mapError(err));
  });
};

/** Translate parser errors into typed HTTP responses; wrap the rest as 500. */
function mapError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ParserError) {
    // Retryable failures (OCR temporarily unavailable) map to 503; the rest are
    // client-correctable and map to 422 with the parser's user-facing message.
    const status = err.retryable ? 503 : 422;
    return new AppError(status, err.userMessage, {
      code: err.code,
      details: { retryable: err.retryable },
    });
  }

  return AppError.internal('Failed to analyze the document');
}
