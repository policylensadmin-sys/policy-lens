// Public routes (mounted under `/api`).
//
// These endpoints are intentionally UNAUTHENTICATED — no `authMiddleware`,
// no RBAC. They power the landing-page experience for prospective users who
// have not created an account (R17.3, R20.7).
//
// Endpoints:
//   POST /try/analyze — ephemeral single-policy preview (multipart `file`).
//                       Bounded by the tighter guest rate limiter and the
//                       standard upload validation chain; nothing is persisted.

import { Router } from 'express';

import { analyzeGuest } from '../controllers/guestController';
import { guestRateLimiter, uploadSingle } from '../middleware/index';

/** Router carrying the public, unauthenticated API surface. */
export const publicRouter = Router();

// POST /api/try/analyze — guest preview. Rate-limit first (cheap rejection of
// abuse before buffering the upload), then validate + parse the file, then run
// the ephemeral analysis. No auth or RBAC by design.
publicRouter.post('/try/analyze', guestRateLimiter, ...uploadSingle, analyzeGuest);
