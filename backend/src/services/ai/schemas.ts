// Runtime validation schemas for live-provider JSON outputs.
//
// `PolicyAnalysisSchema` already lives in @policylens/shared, but the other
// AIProvider return shapes (grounded answers, comparisons, claim simulations,
// broker insights) are declared there as TypeScript interfaces only. Live
// adapters ask the model for strict JSON, so we need Zod schemas to validate
// (and coerce) that JSON before returning it. These mirror the shared
// interfaces exactly and are the single source of truth for parsing.

import { z } from 'zod';
import { INSIGHT_TYPES } from '@policylens/shared';

/** Matches {@link import('@policylens/shared').CitedSection}. */
export const CitedSectionSchema = z.object({
  section: z.string(),
  match: z.number().min(0).max(1),
});

/** Matches {@link import('@policylens/shared').GroundedAnswer}. */
export const GroundedAnswerSchema = z.object({
  answer: z.string(),
  citedSections: z.array(CitedSectionSchema).default([]),
  groundedInPolicy: z.boolean(),
});

/** Matches {@link import('@policylens/shared').ComparisonRow}. */
export const ComparisonRowSchema = z.object({
  label: z.string(),
  valueA: z.string(),
  valueB: z.string(),
  superior: z.enum(['A', 'B', 'equal']),
});

/** Matches {@link import('@policylens/shared').ComparisonResult}. */
export const ComparisonResultSchema = z.object({
  policyAId: z.string(),
  policyBId: z.string(),
  scoreA: z.number(),
  scoreB: z.number(),
  rows: z.array(ComparisonRowSchema).default([]),
  winner: z.enum(['A', 'B', 'tie']),
  recommendation: z.string(),
});

/** Matches {@link import('@policylens/shared').ClaimCheck}. */
export const ClaimCheckSchema = z.object({
  label: z.string(),
  status: z.enum(['ok', 'warn', 'fail']),
  detail: z.string().optional(),
});

/** Matches {@link import('@policylens/shared').ClaimResult}. */
export const ClaimResultSchema = z.object({
  approvalProbability: z.number().min(0).max(100),
  checks: z.array(ClaimCheckSchema).default([]),
  reasons: z.array(z.string()).default([]),
  matchedExclusion: z.string().nullable().optional(),
});

/**
 * Matches {@link import('@policylens/shared').Insight}. `clientIds` and
 * `generatedAt` are filled in by the adapter after validation, so the model is
 * only asked for `type`, `message`, and optional `evidence`.
 */
export const InsightModelSchema = z.object({
  type: z.enum(INSIGHT_TYPES),
  message: z.string(),
  clientIds: z.array(z.string()).default([]),
  evidence: z.unknown().optional(),
});

/** The insights payload the model returns: `{ insights: [...] }`. */
export const InsightListSchema = z.object({
  insights: z.array(InsightModelSchema).default([]),
});
