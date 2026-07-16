// CompareService — side-by-side comparison of two owned policies (R7).
//
// Responsibilities (per design "Services" → CompareService):
//   - Gate the feature behind the Premium tier (R18.2): comparison is a
//     premium-only surface, so free users are rejected with an
//     `upgrade_required` prompt before any work is done.
//   - Load both policies (scoped to the caller via `owner_id`) together with
//     their structured analysis. When either policy has not completed analysis,
//     return an error indicating *which* policy is not ready and prompt the user
//     to finish processing before comparing (R7.5).
//   - Reconstruct a `PolicyAnalysis` for each policy and delegate to
//     `AIProvider.comparePolicies` to produce the structured A/B comparison:
//     per-category rows with a superior indicator, 0–100 scores derived from
//     each policy's Health Score, and a Health-Score-based recommendation
//     (R7.1–R7.4).
//   - Persist the comparison to the `comparisons` table for history.
//
// The AI provider is injected (so it can be mocked in tests); the Supabase
// client is resolved lazily to the service-role client in production.

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ComparisonResult,
  Coverage,
  CoPay,
  Deductible,
  Exclusion,
  FinancialLimit,
  HiddenClause,
  PolicyAnalysis,
  PolicyCategory,
  PolicyStatus,
  Recommendation,
  WaitingPeriod,
} from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import type { AIProvider } from '../ai/types';
import { assertPremiumFeature, PREMIUM_FEATURES, type FreemiumOptions } from './freemium';

/**
 * A structured comparison plus the id of the persisted `comparisons` row (or
 * `null` when persistence failed — the comparison is still returned so the user
 * is never blocked by a history write).
 */
export interface CompareResult extends ComparisonResult {
  comparisonId: string | null;
}

/** An owned policy loaded together with its (optional) analysis. */
interface LoadedPolicy {
  id: string;
  title: string;
  status: PolicyStatus;
  /** Reconstructed analysis, or `null` when the policy has not been analyzed. */
  analysis: PolicyAnalysis | null;
}

/**
 * Compares two owned policies and produces a Health-Score-based recommendation
 * (R7). Inject the {@link AIProvider}; the Supabase client defaults to the
 * service-role client resolved lazily on first use.
 */
export class CompareService {
  private readonly ai: AIProvider;
  private client?: SupabaseClient;

  /**
   * @param ai     AI provider used to build the structured comparison (R7).
   * @param client Supabase client (defaults to the service-role client).
   */
  constructor(ai: AIProvider, client?: SupabaseClient) {
    this.ai = ai;
    this.client = client;
  }

  /** Resolve the Supabase client lazily (service-role by default). */
  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  /**
   * Compare two owned policies (R7).
   *
   * @throws {AppError} `upgrade_required` (402) when the caller is on the free
   *   tier (R18.2); `400` when the two ids are the same; `404` when a policy is
   *   not found/owned; `409` (`policy_not_ready`) naming the policy/policies
   *   whose analysis has not completed (R7.5).
   */
  async compare(
    ownerId: string,
    policyAId: string,
    policyBId: string,
  ): Promise<CompareResult> {
    if (!policyAId || !policyBId) {
      throw AppError.badRequest('Two policies are required to compare.');
    }
    if (policyAId === policyBId) {
      throw AppError.badRequest('Please choose two different policies to compare.');
    }

    // Premium-only feature (R18.2). Enforced before any load so free users get a
    // clean upgrade prompt.
    await this.assertPremium(ownerId);

    // Load both owned policies + analysis (404 when either is missing/un-owned).
    const [a, b] = await Promise.all([
      this.loadOwnedPolicy(ownerId, policyAId),
      this.loadOwnedPolicy(ownerId, policyBId),
    ]);

    // R7.5 — comparison requires both analyses to be complete. Report exactly
    // which policy (or policies) is not ready.
    const notReady: Array<{ id: string; title: string; status: PolicyStatus }> = [];
    if (!isAnalyzed(a)) notReady.push({ id: a.id, title: a.title, status: a.status });
    if (!isAnalyzed(b)) notReady.push({ id: b.id, title: b.title, status: b.status });
    if (notReady.length > 0) {
      const names = notReady.map((p) => `"${p.title}"`).join(' and ');
      throw new AppError(
        409,
        `Analysis is not complete for ${names}. Please wait for processing to finish before comparing.`,
        { code: 'policy_not_ready', details: { notReady } },
      );
    }

    // Both analyses are present (guaranteed by isAnalyzed above).
    const analysisA = a.analysis as PolicyAnalysis;
    const analysisB = b.analysis as PolicyAnalysis;

    // Build the structured A/B comparison (R7.1–R7.4). Scores are derived from
    // each policy's Health Score by the provider.
    const result = await this.ai.comparePolicies(analysisA, analysisB);

    // Bind the comparison to the real policy ids (the provider fills these with
    // provider names by default; callers key results by policy id).
    result.policyAId = a.id;
    result.policyBId = b.id;

    const comparisonId = await this.persist(ownerId, a.id, b.id, result);
    return { ...result, comparisonId };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Premium gate for the comparison feature (R18.2). */
  private async assertPremium(ownerId: string): Promise<void> {
    const opts: FreemiumOptions = { client: this.db() };
    await assertPremiumFeature(ownerId, PREMIUM_FEATURES.comparison, opts);
  }

  /**
   * Load an owned policy and reconstruct its {@link PolicyAnalysis} from the
   * `policies` row (provider/premium/sum insured) plus the embedded
   * `policy_analysis` (coverage, exclusions, etc.). Throws `404` when the policy
   * is not found or not owned by the caller.
   */
  private async loadOwnedPolicy(ownerId: string, policyId: string): Promise<LoadedPolicy> {
    const { data, error } = await this.db()
      .from('policies')
      .select(
        'id, title, category, provider, premium_amount, premium_currency, sum_insured, status, ' +
          'policy_analysis ( health_score, coverage, exclusions, waiting_periods, ' +
          'financial_limits, co_pay, deductibles, hidden_clauses, recommendations, ' +
          'risk_flag_count, not_found, partial )',
      )
      .eq('id', policyId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load policy', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Policy not found');
    }

    const row = data as unknown as PolicyRow;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      analysis: reconstructAnalysis(row),
    };
  }

  /**
   * Persist the comparison to the `comparisons` table (R7). Best-effort: a
   * failure here returns `null` so the comparison is still delivered to the
   * user rather than being lost to a history-write error.
   */
  private async persist(
    ownerId: string,
    policyAId: string,
    policyBId: string,
    result: ComparisonResult,
  ): Promise<string | null> {
    try {
      const { data, error } = await this.db()
        .from('comparisons')
        .insert({
          owner_id: ownerId,
          policy_a_id: policyAId,
          policy_b_id: policyBId,
          result,
          recommendation: result.recommendation,
        })
        .select('id')
        .single();

      if (error || !data?.id) return null;
      return data.id as string;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shape of the embedded `policy_analysis` columns selected with a policy. */
interface AnalysisEmbed {
  health_score: number | null;
  coverage?: unknown;
  exclusions?: unknown;
  waiting_periods?: unknown;
  financial_limits?: unknown;
  co_pay?: unknown;
  deductibles?: unknown;
  hidden_clauses?: unknown;
  recommendations?: unknown;
  risk_flag_count?: number | null;
  not_found?: unknown;
  partial?: boolean | null;
}

/** A `policies` row with its optional embedded one-to-one `policy_analysis`. */
interface PolicyRow {
  id: string;
  title: string;
  category: PolicyCategory;
  provider: string | null;
  premium_amount: number | string | null;
  premium_currency: string | null;
  sum_insured: number | string | null;
  status: PolicyStatus;
  policy_analysis?: AnalysisEmbed | AnalysisEmbed[] | null;
}

/** A loaded policy is comparable only once its analysis has completed (R7.5). */
function isAnalyzed(policy: LoadedPolicy): boolean {
  return policy.status === 'analyzed' && policy.analysis !== null;
}

/** Normalize an embedded analysis (array | object | null) to a single record. */
function firstAnalysis(embed: PolicyRow['policy_analysis']): AnalysisEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** Coerce a numeric-or-string DB value (numeric columns arrive as strings). */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an unknown JSONB value to a typed array (empty on mismatch). */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Rebuild a full {@link PolicyAnalysis} from a policy row and its embedded
 * analysis, or return `null` when the policy has no analysis row yet. The
 * provider/premium/sum-insured fields live on the `policies` row; the rest come
 * from `policy_analysis`.
 */
function reconstructAnalysis(row: PolicyRow): PolicyAnalysis | null {
  const a = firstAnalysis(row.policy_analysis);
  if (!a) return null;

  return {
    category: row.category,
    provider: row.provider ?? 'Unknown',
    premium: {
      amount: toNumber(row.premium_amount),
      currency: row.premium_currency ?? 'INR',
    },
    sumInsured: toNumber(row.sum_insured),
    coverage: toArray<Coverage>(a.coverage),
    exclusions: toArray<Exclusion>(a.exclusions),
    waitingPeriods: toArray<WaitingPeriod>(a.waiting_periods),
    financialLimits: toArray<FinancialLimit>(a.financial_limits),
    coPay: toArray<CoPay>(a.co_pay),
    deductibles: toArray<Deductible>(a.deductibles),
    hiddenClauses: toArray<HiddenClause>(a.hidden_clauses),
    recommendations: toArray<Recommendation>(a.recommendations),
    healthScore: a.health_score ?? undefined,
    riskFlagCount: a.risk_flag_count ?? undefined,
    notFound: toArray<string>(a.not_found),
    partial: a.partial ?? false,
  };
}
