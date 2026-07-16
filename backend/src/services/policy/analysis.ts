// AnalysisService — orchestrates structured policy analysis (R3).
//
// This service sits above the provider-agnostic AI layer. The AIProvider
// (mock / Anthropic / OpenAI) owns the LLM prompt/parse/repair concerns and
// returns a structured PolicyAnalysis. This service is responsible for the
// service-level orchestration around that result:
//
//   1. Validate the provider output against `PolicyAnalysisSchema` (R3.1).
//   2. On validation failure, perform ONE repair attempt (re-call the provider)
//      and, if that also fails, fall back to a PARTIAL result — `partial=true`
//      with `notFound` listing the categories that could not be produced —
//      rather than throwing (R3.10).
//   3. Explicitly indicate empty categories by listing them in `notFound`
//      (R3.9): a category with no items is represented as an empty array and
//      named in `notFound` when truly absent.
//   4. Compute `riskFlagCount` deterministically from High/Medium hidden
//      clauses when the provider did not already set it (R3.7, R3.8).
//   5. Integrate the deterministic Health Score computed in code (R3.8).
//
// The live providers already perform their own internal strict-JSON repair
// retry; the repair attempt here is the service-level safety net that turns a
// hard provider/validation failure into a usable partial analysis.

import {
  PolicyAnalysisSchema,
  type Money,
  type PolicyAnalysis,
} from '@policylens/shared';
import type { AIProvider } from '../ai/types';
// Deterministic Health Score scoring (task 5.6). This module is created
// concurrently; the import resolves once 5.6 lands. Expected signature:
//   computeHealthScore(analysis: PolicyAnalysis): number
import { computeHealthScore } from './healthScore';

/**
 * Analysis categories that must be explicitly represented even when empty
 * (R3.9): exclusions, waiting periods, financial limits, co-pay clauses, and
 * hidden clauses. When one of these is absent from a policy it is returned as
 * an empty array and its name is added to `notFound`.
 */
const EXPLICIT_CATEGORIES = [
  'exclusions',
  'waitingPeriods',
  'financialLimits',
  'coPay',
  'hiddenClauses',
] as const;

type ExplicitCategory = (typeof EXPLICIT_CATEGORIES)[number];

/** Fallback premium used when a valid analysis could not be produced. */
const FALLBACK_PREMIUM: Money = { amount: 0, currency: 'INR' };

/**
 * Orchestrates producing a validated, fully-populated {@link PolicyAnalysis}
 * from raw policy text. Depends only on the {@link AIProvider} abstraction so
 * it works identically against mock and live providers.
 */
export class AnalysisService {
  constructor(private readonly aiProvider: AIProvider) {}

  /**
   * Analyze raw policy text into a structured, schema-valid analysis.
   *
   * Attempts analysis, validates the result, and performs one repair retry on
   * validation failure. If both attempts fail, returns a partial result rather
   * than throwing (R3.10). The returned analysis always has `riskFlagCount`,
   * `healthScore`, and explicit empty-category indication populated.
   */
  async analyze(text: string): Promise<PolicyAnalysis> {
    // First attempt.
    const first = await this.attempt(text);
    if (first) return this.finalize(first);

    // Single repair attempt (re-call the provider).
    const repaired = await this.attempt(text);
    if (repaired) return this.finalize(repaired);

    // Both attempts failed — degrade gracefully to a partial result (R3.10).
    return this.finalize(this.buildPartialFallback());
  }

  /**
   * Run one provider call and validate the result against the schema. Returns
   * the validated analysis, or `null` when the provider throws or the output
   * fails validation (so the caller can decide whether to retry / fall back).
   */
  private async attempt(text: string): Promise<PolicyAnalysis | null> {
    let raw: unknown;
    try {
      raw = await this.aiProvider.analyzePolicy(text);
    } catch {
      // Provider hard failure (transport, unparseable output after its own
      // internal repair, etc.) — treated the same as a validation miss.
      return null;
    }

    const parsed = PolicyAnalysisSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Build the minimal schema-valid skeleton returned when no valid analysis
   * could be produced. Marked `partial` with every analysis category flagged
   * as not found (R3.10); `finalize` fills in `notFound`, `riskFlagCount`, and
   * the health score.
   */
  private buildPartialFallback(): PolicyAnalysis {
    return PolicyAnalysisSchema.parse({
      provider: 'Unknown',
      premium: FALLBACK_PREMIUM,
      sumInsured: 0,
      coverage: [],
      exclusions: [],
      waitingPeriods: [],
      financialLimits: [],
      coPay: [],
      deductibles: [],
      hiddenClauses: [],
      recommendations: [],
      notFound: [],
      partial: true,
    });
  }

  /**
   * Apply the deterministic, service-level post-processing to a validated
   * analysis: explicit empty-category indication (R3.9), risk-flag count
   * (R3.7/R3.8), and the Health Score (R3.8).
   */
  private finalize(analysis: PolicyAnalysis): PolicyAnalysis {
    const notFound = this.withEmptyCategories(analysis);
    const riskFlagCount = analysis.riskFlagCount ?? countRiskFlags(analysis);

    const enriched: PolicyAnalysis = {
      ...analysis,
      notFound,
      riskFlagCount,
    };

    // Health Score is computed in code for reproducibility/testability (R3.8).
    return { ...enriched, healthScore: computeHealthScore(enriched) };
  }

  /**
   * Return `notFound` extended so that every empty explicit category (R3.9) is
   * listed exactly once, preserving any entries the provider already reported.
   */
  private withEmptyCategories(analysis: PolicyAnalysis): string[] {
    const notFound = new Set(analysis.notFound);
    for (const category of EXPLICIT_CATEGORIES) {
      if (isEmptyCategory(analysis, category)) {
        notFound.add(category);
      }
    }
    return [...notFound];
  }
}

/** Count hidden clauses flagged High or Medium — the dashboard risk flags. */
function countRiskFlags(analysis: PolicyAnalysis): number {
  return analysis.hiddenClauses.filter((c) => c.risk === 'High' || c.risk === 'Medium').length;
}

/** True when the given explicit category has no items in the analysis. */
function isEmptyCategory(analysis: PolicyAnalysis, category: ExplicitCategory): boolean {
  return analysis[category].length === 0;
}
