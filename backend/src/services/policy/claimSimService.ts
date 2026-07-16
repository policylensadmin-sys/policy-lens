// ClaimSimService — evaluate a plain-language claim scenario against a policy (R8).
//
// Responsibilities (per design "Services" → ClaimSimService):
//   - Gate the feature behind the Premium tier (R18.2): the Claim Simulator is
//     premium-only, so free users are rejected with an `upgrade_required`
//     prompt before any work is done.
//   - Load the owned policy + analysis (404 when not owned, `policy_not_ready`
//     when analysis has not completed).
//   - Guard against under-specified scenarios: when the description is too thin
//     to evaluate, prompt the user for the specific details that are needed
//     (R8.6) instead of returning a misleading probability.
//   - Delegate the core evaluation to `AIProvider.simulateClaim`, which checks
//     waiting periods, coverage, exclusion matches, financial limits, and
//     co-pay, returning an approval probability, satisfied/warn checks, reasons,
//     and any matched exclusion (R8.1–R8.5).
//   - Detect the "not covered" case — the scenario matches no coverage area and
//     no exclusion — and surface the available coverage areas (R8.7).
//   - Persist the simulation to the `claim_simulations` table for history.
//
// The AI provider is injected (mockable in tests); the Supabase client resolves
// lazily to the service-role client in production.

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ClaimCheck,
  ClaimResult,
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

/** Maximum length (characters) of a claim scenario, mirroring the chat cap. */
export const MAX_SCENARIO_LENGTH = 1000;

/**
 * Minimum characters/words a scenario must carry to be evaluable. Anything
 * shorter is treated as "insufficient detail" and prompts the user for more
 * (R8.6) rather than producing a misleading result.
 */
const MIN_SCENARIO_CHARS = 15;
const MIN_SCENARIO_WORDS = 4;

/**
 * The result of a claim simulation. Extends the shared {@link ClaimResult} with
 * the service-derived flags that satisfy the insufficient-detail (R8.6) and
 * not-covered (R8.7) messaging, plus the policy the scenario was run against.
 */
export interface ClaimSimulationResult extends ClaimResult {
  policyId: string;
  /** True when the scenario lacked enough detail to evaluate (R8.6). */
  insufficientDetail: boolean;
  /** When `insufficientDetail`, the specific details the user should add (R8.6). */
  neededDetails?: string[];
  /** True when the scenario matches no coverage area in the policy (R8.7). */
  notCovered: boolean;
  /** Coverage areas available under the policy, surfaced when not covered (R8.7). */
  availableCoverage?: string[];
}

/** An owned policy loaded together with its (optional) analysis. */
interface LoadedPolicy {
  id: string;
  title: string;
  status: PolicyStatus;
  analysis: PolicyAnalysis | null;
}

/**
 * Evaluates claim scenarios against an owned policy (R8). Inject the
 * {@link AIProvider}; the Supabase client defaults to the service-role client
 * resolved lazily on first use.
 */
export class ClaimSimService {
  private readonly ai: AIProvider;
  private client?: SupabaseClient;

  /**
   * @param ai     AI provider used to evaluate the scenario (R8).
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
   * Simulate a claim scenario against an owned policy (R8).
   *
   * @throws {AppError} `upgrade_required` (402) when the caller is on the free
   *   tier (R18.2); `400` when the scenario is empty or exceeds
   *   {@link MAX_SCENARIO_LENGTH}; `404` when the policy is not found/owned;
   *   `409` (`policy_not_ready`) when the policy's analysis is incomplete.
   */
  async simulate(
    ownerId: string,
    policyId: string,
    scenario: string,
  ): Promise<ClaimSimulationResult> {
    if (!policyId) {
      throw AppError.badRequest('A policy is required to simulate a claim.');
    }

    const trimmed = (scenario ?? '').trim();
    if (trimmed.length === 0) {
      throw AppError.badRequest('Please describe the claim scenario you want to simulate.');
    }
    if (trimmed.length > MAX_SCENARIO_LENGTH) {
      throw AppError.badRequest(
        `Your scenario is too long. Please keep it to ${MAX_SCENARIO_LENGTH} characters or fewer.`,
      );
    }

    // Premium-only feature (R18.2). Enforced before any load.
    await this.assertPremium(ownerId);

    // Load the owned policy + analysis, requiring completed analysis.
    const policy = await this.loadReadyPolicy(ownerId, policyId);
    const analysis = policy.analysis as PolicyAnalysis;

    // R8.6 — under-specified scenario: prompt for the details we need rather
    // than guessing at a probability.
    if (isInsufficientDetail(trimmed)) {
      const result = insufficientDetailResult(policyId);
      await this.persist(ownerId, policyId, trimmed, result);
      return result;
    }

    // Core evaluation of waiting periods, coverage, exclusions, limits, and
    // co-pay (R8.1–R8.5).
    const claim = await this.ai.simulateClaim(analysis, trimmed);

    // R8.7 — the scenario matches neither a coverage area nor an exclusion: it
    // is not covered. Surface the available coverage areas instead of a score.
    if (!claim.matchedExclusion && !scenarioMatchesCoverage(trimmed, analysis)) {
      const result = notCoveredResult(policyId, analysis);
      await this.persist(ownerId, policyId, trimmed, result);
      return result;
    }

    const result: ClaimSimulationResult = {
      policyId,
      approvalProbability: claim.approvalProbability,
      checks: claim.checks,
      reasons: claim.reasons,
      matchedExclusion: claim.matchedExclusion ?? null,
      insufficientDetail: false,
      notCovered: false,
    };

    await this.persist(ownerId, policyId, trimmed, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Premium gate for the Claim Simulator feature (R18.2). */
  private async assertPremium(ownerId: string): Promise<void> {
    const opts: FreemiumOptions = { client: this.db() };
    await assertPremiumFeature(ownerId, PREMIUM_FEATURES.claimSimulator, opts);
  }

  /**
   * Load an owned policy with its reconstructed analysis, requiring that
   * analysis has completed. Throws `404` when not found/owned and `409`
   * (`policy_not_ready`) when the policy is still processing or failed.
   */
  private async loadReadyPolicy(ownerId: string, policyId: string): Promise<LoadedPolicy> {
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
    const analysis = reconstructAnalysis(row);

    if (row.status !== 'analyzed' || analysis === null) {
      throw new AppError(
        409,
        `Analysis is not complete for "${row.title}". Please wait for processing to finish before simulating a claim.`,
        { code: 'policy_not_ready', details: { policyId: row.id, status: row.status } },
      );
    }

    return { id: row.id, title: row.title, status: row.status, analysis };
  }

  /**
   * Persist the simulation to `claim_simulations` (R8). Best-effort: a failure
   * here is swallowed so the result is still delivered to the user.
   */
  private async persist(
    ownerId: string,
    policyId: string,
    scenario: string,
    result: ClaimSimulationResult,
  ): Promise<void> {
    try {
      await this.db()
        .from('claim_simulations')
        .insert({
          owner_id: ownerId,
          policy_id: policyId,
          scenario,
          approval_probability: result.approvalProbability,
          reasons: result.reasons,
          matched_exclusion: result.matchedExclusion ?? null,
        });
    } catch {
      // History persistence is best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario evaluation helpers (R8.6 / R8.7)
// ---------------------------------------------------------------------------

/**
 * A scenario is "insufficient detail" when it is too short or has too few
 * words to evaluate meaningfully against policy terms (R8.6).
 */
function isInsufficientDetail(scenario: string): boolean {
  if (scenario.length < MIN_SCENARIO_CHARS) return true;
  const words = scenario.split(/\s+/).filter((w) => w.length > 0);
  return words.length < MIN_SCENARIO_WORDS;
}

/** The prompt-for-more-detail result returned for thin scenarios (R8.6). */
function insufficientDetailResult(policyId: string): ClaimSimulationResult {
  const neededDetails = [
    'What treatment, procedure, or event is the claim for?',
    'When did (or will) it happen, relative to your policy start date?',
    'Which person on the policy does it involve?',
    'The estimated amount you expect to claim.',
  ];
  const checks: ClaimCheck[] = [
    {
      label: 'More information needed',
      status: 'warn',
      detail: 'The scenario is too brief to evaluate against your policy terms.',
    },
  ];
  return {
    policyId,
    approvalProbability: 0,
    checks,
    reasons: neededDetails,
    matchedExclusion: null,
    insufficientDetail: true,
    neededDetails,
    notCovered: false,
  };
}

/** The not-covered result surfacing the policy's available coverage (R8.7). */
function notCoveredResult(policyId: string, analysis: PolicyAnalysis): ClaimSimulationResult {
  const availableCoverage = coveredTypes(analysis);
  const list = availableCoverage.length > 0 ? availableCoverage.join(', ') : 'the listed benefits';
  const checks: ClaimCheck[] = [
    {
      label: 'Coverage',
      status: 'fail',
      detail: 'The described scenario does not match any coverage area in this policy.',
    },
  ];
  return {
    policyId,
    approvalProbability: 0,
    checks,
    reasons: [
      'The described scenario does not appear to be covered under this policy.',
      `This policy covers: ${list}.`,
    ],
    matchedExclusion: null,
    insufficientDetail: false,
    notCovered: true,
    availableCoverage,
  };
}

/** The covered coverage-type labels for a policy (R8.7 available coverage). */
function coveredTypes(analysis: PolicyAnalysis): string[] {
  return analysis.coverage
    .filter((c) => c.covered)
    .map((c) => c.type)
    .filter((type, index, all) => all.indexOf(type) === index);
}

/**
 * Whether the scenario references any covered coverage area. Matches on
 * meaningful tokens (length ≥ 4) drawn from each covered item's `type` and
 * `detail`, so a scenario is considered covered when it shares vocabulary with
 * the policy's benefits. Conservative by design: any overlap counts as covered
 * so normal scenarios are not misflagged as out-of-scope (R8.7).
 */
function scenarioMatchesCoverage(scenario: string, analysis: PolicyAnalysis): boolean {
  const covered = analysis.coverage.filter((c) => c.covered);
  if (covered.length === 0) return false;

  const scenarioText = scenario.toLowerCase();
  for (const item of covered) {
    const tokens = tokenize(`${item.type} ${item.detail}`);
    if (tokens.some((t) => scenarioText.includes(t))) {
      return true;
    }
  }
  return false;
}

/** Split text into lowercase alphabetic tokens of length ≥ 4. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4);
}

// ---------------------------------------------------------------------------
// Analysis reconstruction (policy row + embedded analysis → PolicyAnalysis)
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

/** Rebuild a full {@link PolicyAnalysis}, or `null` when no analysis exists. */
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
