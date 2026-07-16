// Structured policy analysis types and the Zod schema used to validate the
// AI-produced analysis JSON (R3). Types are inferred from the schema so the
// runtime validator and the compile-time types never drift apart.

import { z } from 'zod';
import { POLICY_CATEGORIES, RECOMMENDATION_KINDS, RISK_LEVELS } from './enums.js';

/** Premium amount + currency. */
export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string().default('INR'),
});

/** A single coverage line item. */
export const CoverageSchema = z.object({
  type: z.string(),
  detail: z.string(),
  covered: z.boolean(),
});

/** An exclusion with a plain-English explanation (≤100 words). */
export const ExclusionSchema = z.object({
  name: z.string(),
  explanation: z.string(),
});

/** A waiting period and what it applies to. */
export const WaitingPeriodSchema = z.object({
  duration: z.string(),
  appliesTo: z.string(),
});

/** A financial limit / sub-limit (e.g. room rent cap). */
export const FinancialLimitSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string().optional(),
});

/** A co-payment obligation. */
export const CoPaySchema = z.object({
  percent: z.number(),
  condition: z.string().optional(),
});

/** A deductible amount. */
export const DeductibleSchema = z.object({
  amount: z.number(),
});

/** A hidden / high-impact clause flagged with a risk level. */
export const HiddenClauseSchema = z.object({
  clause: z.string(),
  risk: z.enum(RISK_LEVELS),
  impact: z.string(),
});

/** An actionable recommendation (coverage gap vs risk mitigation). */
export const RecommendationSchema = z.object({
  kind: z.enum(RECOMMENDATION_KINDS),
  title: z.string(),
  detail: z.string(),
});

/**
 * Full structured analysis of a policy. Mirrors the analysis JSON schema in the
 * design. `healthScore` and `riskFlagCount` are computed deterministically in
 * code (not by the LLM), so they are optional on the raw AI payload. `partial`
 * and `notFound` support the repair-retry / partial-result fallback (R3.9, R3.10).
 */
export const PolicyAnalysisSchema = z.object({
  category: z.enum(POLICY_CATEGORIES).optional(),
  provider: z.string(),
  premium: MoneySchema,
  sumInsured: z.number(),
  coverage: z.array(CoverageSchema).default([]),
  exclusions: z.array(ExclusionSchema).default([]),
  waitingPeriods: z.array(WaitingPeriodSchema).default([]),
  financialLimits: z.array(FinancialLimitSchema).default([]),
  coPay: z.array(CoPaySchema).default([]),
  deductibles: z.array(DeductibleSchema).default([]),
  hiddenClauses: z.array(HiddenClauseSchema).default([]),
  recommendations: z.array(RecommendationSchema).default([]),
  healthScore: z.number().int().min(0).max(100).optional(),
  riskFlagCount: z.number().int().min(0).optional(),
  notFound: z.array(z.string()).default([]),
  partial: z.boolean().default(false),
});

// Types inferred from the schemas (single source of truth).
export type Money = z.infer<typeof MoneySchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type Exclusion = z.infer<typeof ExclusionSchema>;
export type WaitingPeriod = z.infer<typeof WaitingPeriodSchema>;
export type FinancialLimit = z.infer<typeof FinancialLimitSchema>;
export type CoPay = z.infer<typeof CoPaySchema>;
export type Deductible = z.infer<typeof DeductibleSchema>;
export type HiddenClause = z.infer<typeof HiddenClauseSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type PolicyAnalysis = z.infer<typeof PolicyAnalysisSchema>;
