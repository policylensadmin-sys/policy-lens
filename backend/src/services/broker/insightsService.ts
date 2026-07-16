// InsightsService — broker AI insights + reports/analytics (R13, R19.7).
//
// Owns the Supabase reads/writes behind the `/api/broker/insights`,
// `/api/broker/reports`, and `/api/broker/analytics` surfaces.
//
//   • getInsights (R13) — builds a PortfolioSummary from the broker's clients
//     and policies, asks the AI provider for categorized recommendations
//     (upsell / risk_alert / renewal_opt / coverage_improvement), augments them
//     with coverage-gap-derived insights (R13.2), and persists the result into
//     `ai_insights`. Cached rows are reused while fresh (< 24h) and refreshed
//     otherwise (R13.1). When the portfolio has insufficient data, or the AI
//     provider fails, a fallback is returned carrying the timestamp of the last
//     successfully generated insights (R13.5).
//
//   • getReports / getAnalytics (R19.7) — aggregate policy volume, premium
//     revenue, claims activity, and commission earned for the broker.
//
// Every read is scoped to the caller's broker (broker_id / policy-id scoping
// mirrors the RLS policy). The service resolves the service-role Supabase client
// and the AI provider lazily so the module imports cleanly in mock/dev mode.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Insight, PortfolioPolicySummary, PortfolioSummary } from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import { createAiProviders } from '../ai/factory';
import type { AIProvider } from '../ai/types';
import {
  computeCommissionOverview,
  computePremiumCollection,
  round2,
  type CommissionOverview,
  type PremiumCollection,
} from './brokerDashboardService';
import {
  deriveCoverageGaps,
  toRiskFlags,
  countRisk,
  type ClientRiskInput,
  type CoverageGap,
  type RiskCategory,
} from './clientLogic';

/** Insights are considered stale once they are older than this (R13.1: ≥24h). */
export const INSIGHT_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Fallback currency when the broker has none configured (mirrors dashboard). */
const DEFAULT_CURRENCY = 'INR';

/** A single insight as returned to the broker portal (camel-cased). */
export interface InsightView {
  id?: string;
  type: Insight['type'];
  message: string;
  clientIds: string[];
  evidence?: unknown;
  generatedAt: string | null;
}

/**
 * Result of {@link InsightsService.getInsights}. When `available` is false the
 * insight list is empty and `lastGeneratedAt` carries the timestamp of the last
 * successfully generated insights (or null if none were ever generated), so the
 * portal can show the "temporarily unavailable" notification (R13.5).
 */
export interface InsightsResult {
  available: boolean;
  insights: InsightView[];
  /** When the returned insights were generated (null on fallback). */
  generatedAt: string | null;
  /** Timestamp of the last successful generation (for the fallback notice). */
  lastGeneratedAt: string | null;
  /** Present on fallback: explains why insights are unavailable (R13.5). */
  message?: string;
}

/** Policy-volume aggregation (R19.7). */
export interface PolicyVolume {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

/** Premium-revenue aggregation (R19.7). */
export interface PremiumRevenue {
  total: number;
  byType: Record<string, number>;
}

/** Claims-activity aggregation (R19.7). */
export interface ClaimsActivity {
  total: number;
  byStatus: Record<string, number>;
  totalClaimedAmount: number;
}

/** Reports payload: point-in-time totals across the four categories (R19.7). */
export interface BrokerReports {
  brokerId: string;
  currency: string;
  policyVolume: PolicyVolume;
  premiumRevenue: PremiumRevenue;
  claimsActivity: ClaimsActivity;
  commission: CommissionOverview;
}

/** One slice of the portfolio policy mix (R19.7). */
export interface PolicyMixSlice {
  type: string;
  count: number;
  premium: number;
  /** Share of total policies as a percentage (0–100, 2 decimals). */
  share: number;
}

/** Claims breakdown with an approval rate (R19.7). */
export interface ClaimsBreakdown {
  total: number;
  byStatus: Record<string, number>;
  /** Approved claims as a percentage of all claims (0–100, 2 decimals). */
  approvalRate: number;
}

/** Analytics payload: trends + breakdowns across the four categories (R19.7). */
export interface BrokerAnalytics {
  brokerId: string;
  currency: string;
  /** Trailing-12-month premium series broken down by insurance type (R19.7). */
  premiumTrend: PremiumCollection;
  policyMix: PolicyMixSlice[];
  claims: ClaimsBreakdown;
  commission: CommissionOverview;
}

// Raw row shapes read from Supabase.
interface ClientWithPoliciesRow {
  id: string;
  full_name: string;
  risk_flags: unknown;
  broker_policies?: PortfolioPolicyRow[] | null;
}
interface PortfolioPolicyRow {
  id: string;
  policy_type: string | null;
  premium_amount: number | string | null;
  sum_insured: number | string | null;
  deductible: number | string | null;
  end_date: string | null;
}
interface AiInsightRow {
  id: string;
  type: Insight['type'];
  message: string;
  client_ids: string[] | null;
  evidence: unknown;
  generated_at: string | null;
}
interface ReportPolicyRow {
  id: string;
  policy_type: string | null;
  premium_amount: number | string | null;
  status: string | null;
  start_date: string | null;
}
interface ReportClaimRow {
  status: string | null;
  claimed_amount: number | string | null;
}
interface ReportCommissionRow {
  amount: number | string | null;
  status: string | null;
  scheduled_date: string | null;
  paid_date: string | null;
}

const CLIENT_PORTFOLIO_SELECT =
  'id, full_name, risk_flags, broker_policies (id, policy_type, premium_amount, ' +
  'sum_insured, deductible, end_date)';

/** Owns broker AI insights generation + reports/analytics (R13, R19.7). */
export class InsightsService {
  private client?: SupabaseClient;
  private aiProvider?: AIProvider;

  constructor(ai?: AIProvider, client?: SupabaseClient) {
    this.aiProvider = ai;
    this.client = client;
  }

  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  private ai(): AIProvider {
    if (!this.aiProvider) this.aiProvider = createAiProviders({ silent: true }).ai;
    return this.aiProvider;
  }

  /**
   * Resolve the broker id for the authenticated auth user id. Walks
   * `profiles.user_id → profiles.id → brokers.profile_id → brokers.id`.
   * Throws `403` if the user has no broker account.
   */
  async resolveBrokerId(userId: string): Promise<string> {
    const db = this.db();

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (profileError || !profile?.id) {
      throw AppError.forbidden('No profile found for the authenticated user');
    }

    const { data: broker, error: brokerError } = await db
      .from('brokers')
      .select('id')
      .eq('profile_id', profile.id as string)
      .maybeSingle();
    if (brokerError || !broker?.id) {
      throw AppError.forbidden('No broker account is associated with this user');
    }

    return broker.id as string;
  }

  /**
   * Return the broker's categorized AI insights (R13). Cached `ai_insights`
   * rows are reused while fresh (generated < 24h ago, R13.1); otherwise they are
   * regenerated from the current portfolio, augmented with coverage-gap insights
   * (R13.2), persisted, and returned. When the portfolio has too little data to
   * analyze, or the AI provider fails, a fallback carrying the last successful
   * generation timestamp is returned instead (R13.5).
   */
  async getInsights(brokerId: string, now: Date = new Date()): Promise<InsightsResult> {
    const cached = await this.fetchCachedInsights(brokerId);
    const lastGeneratedAt = latestTimestamp(cached);

    // Serve cached insights while they are still fresh (< 24h old).
    if (cached.length > 0 && lastGeneratedAt && isFresh(lastGeneratedAt, now)) {
      return {
        available: true,
        insights: cached.map(mapInsightRow),
        generatedAt: lastGeneratedAt,
        lastGeneratedAt,
      };
    }

    // Regenerate from the current portfolio.
    const clients = await this.fetchClientsWithPolicies(brokerId);
    const portfolio = buildPortfolioSummary(brokerId, clients);

    // Insufficient client data → fallback (R13.5).
    if (portfolio.totalPolicies === 0) {
      return {
        available: false,
        insights: [],
        generatedAt: null,
        lastGeneratedAt,
        message: 'Insights are temporarily unavailable due to insufficient client data.',
      };
    }

    const generatedAtIso = now.toISOString();
    let fresh: Insight[];
    try {
      const aiInsights = await this.ai().brokerInsights(portfolio);
      const gapInsights = buildCoverageGapInsights(clients, generatedAtIso);
      fresh = [...aiInsights, ...gapInsights].map((insight) => ({
        ...insight,
        generatedAt: generatedAtIso,
      }));
    } catch {
      // AI service unavailable → fallback with the last successful timestamp (R13.5).
      return {
        available: false,
        insights: [],
        generatedAt: null,
        lastGeneratedAt,
        message: 'Insights are temporarily unavailable. Please try again later.',
      };
    }

    const persisted = await this.persistInsights(brokerId, fresh, generatedAtIso);
    return {
      available: true,
      insights: persisted,
      generatedAt: generatedAtIso,
      lastGeneratedAt: generatedAtIso,
    };
  }

  /**
   * Aggregate the broker's reports: policy volume, premium revenue, claims
   * activity, and commission earned (R19.7). Zero totals are returned when the
   * broker has no data.
   */
  async getReports(brokerId: string, now: Date = new Date()): Promise<BrokerReports> {
    const { currency, policies, claims, commissions } = await this.loadPortfolioData(brokerId);

    const policyVolume: PolicyVolume = { total: policies.length, byType: {}, byStatus: {} };
    const premiumRevenue: PremiumRevenue = { total: 0, byType: {} };

    for (const p of policies) {
      const type = normalizeType(p.policy_type);
      const status = normalizeStatus(p.status);
      policyVolume.byType[type] = (policyVolume.byType[type] ?? 0) + 1;
      policyVolume.byStatus[status] = (policyVolume.byStatus[status] ?? 0) + 1;

      const premium = toNumber(p.premium_amount);
      premiumRevenue.total = round2(premiumRevenue.total + premium);
      premiumRevenue.byType[type] = round2((premiumRevenue.byType[type] ?? 0) + premium);
    }

    const claimsActivity: ClaimsActivity = {
      total: claims.length,
      byStatus: {},
      totalClaimedAmount: 0,
    };
    for (const c of claims) {
      const status = normalizeStatus(c.status);
      claimsActivity.byStatus[status] = (claimsActivity.byStatus[status] ?? 0) + 1;
      claimsActivity.totalClaimedAmount = round2(
        claimsActivity.totalClaimedAmount + toNumber(c.claimed_amount),
      );
    }

    return {
      brokerId,
      currency,
      policyVolume,
      premiumRevenue,
      claimsActivity,
      commission: computeCommissionOverview(commissions, currency, now),
    };
  }

  /**
   * Aggregate the broker's analytics: a trailing-12-month premium trend, the
   * portfolio policy mix, a claims breakdown with approval rate, and the
   * commission overview (R19.7). Empty structures are returned when the broker
   * has no data.
   */
  async getAnalytics(brokerId: string, now: Date = new Date()): Promise<BrokerAnalytics> {
    const { currency, policies, claims, commissions } = await this.loadPortfolioData(brokerId);

    // Premium trend reuses the dashboard's 12-month, by-type aggregation.
    const premiumTrend = computePremiumCollection(
      policies.map((p) => ({
        id: p.id,
        policy_type: p.policy_type,
        premium_amount: p.premium_amount,
        status: p.status,
        start_date: p.start_date,
      })),
      now,
    );

    // Policy mix: count + premium + share by insurance type.
    const totalPolicies = policies.length;
    const mixIndex = new Map<string, { count: number; premium: number }>();
    for (const p of policies) {
      const type = normalizeType(p.policy_type);
      const entry = mixIndex.get(type) ?? { count: 0, premium: 0 };
      entry.count += 1;
      entry.premium = round2(entry.premium + toNumber(p.premium_amount));
      mixIndex.set(type, entry);
    }
    const policyMix: PolicyMixSlice[] = [...mixIndex.entries()]
      .map(([type, entry]) => ({
        type,
        count: entry.count,
        premium: entry.premium,
        share: totalPolicies > 0 ? round2((entry.count / totalPolicies) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    // Claims breakdown with approval rate.
    const byStatus: Record<string, number> = {};
    let approved = 0;
    for (const c of claims) {
      const status = normalizeStatus(c.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (status === 'approved') approved += 1;
    }
    const claimsBreakdown: ClaimsBreakdown = {
      total: claims.length,
      byStatus,
      approvalRate: claims.length > 0 ? round2((approved / claims.length) * 100) : 0,
    };

    return {
      brokerId,
      currency,
      premiumTrend,
      policyMix,
      claims: claimsBreakdown,
      commission: computeCommissionOverview(commissions, currency, now),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Read cached insight rows for the broker, newest first. */
  private async fetchCachedInsights(brokerId: string): Promise<AiInsightRow[]> {
    const { data, error } = await this.db()
      .from('ai_insights')
      .select('id, type, message, client_ids, evidence, generated_at')
      .eq('broker_id', brokerId)
      .order('generated_at', { ascending: false, nullsFirst: false });

    if (error) {
      throw AppError.internal('Failed to load AI insights', { reason: error.message });
    }
    return (data as AiInsightRow[] | null) ?? [];
  }

  /** Load the broker's clients with their policies for portfolio analysis. */
  private async fetchClientsWithPolicies(brokerId: string): Promise<ClientWithPoliciesRow[]> {
    const { data, error } = await this.db()
      .from('clients')
      .select(CLIENT_PORTFOLIO_SELECT)
      .eq('broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load clients for insights', { reason: error.message });
    }
    return (data as unknown as ClientWithPoliciesRow[] | null) ?? [];
  }

  /**
   * Replace the broker's cached insights with the freshly generated set and
   * return the persisted rows (with their new ids). Deleting first keeps the
   * cache a faithful snapshot of the latest generation (R13.1).
   */
  private async persistInsights(
    brokerId: string,
    insights: Insight[],
    generatedAtIso: string,
  ): Promise<InsightView[]> {
    const db = this.db();

    const { error: deleteError } = await db.from('ai_insights').delete().eq('broker_id', brokerId);
    if (deleteError) {
      throw AppError.internal('Failed to refresh AI insights', { reason: deleteError.message });
    }

    if (insights.length === 0) return [];

    const rows = insights.map((insight) => ({
      broker_id: brokerId,
      type: insight.type,
      message: insight.message,
      client_ids: insight.clientIds ?? [],
      evidence: insight.evidence ?? {},
      generated_at: generatedAtIso,
    }));

    const { data, error: insertError } = await db
      .from('ai_insights')
      .insert(rows)
      .select('id, type, message, client_ids, evidence, generated_at');

    if (insertError) {
      throw AppError.internal('Failed to persist AI insights', { reason: insertError.message });
    }

    return ((data as AiInsightRow[] | null) ?? []).map(mapInsightRow);
  }

  /** Fetch the broker's currency plus policies, claims, and commissions. */
  private async loadPortfolioData(brokerId: string): Promise<{
    currency: string;
    policies: ReportPolicyRow[];
    claims: ReportClaimRow[];
    commissions: ReportCommissionRow[];
  }> {
    const db = this.db();

    const { data: broker, error: brokerError } = await db
      .from('brokers')
      .select('currency')
      .eq('id', brokerId)
      .maybeSingle();
    if (brokerError) {
      throw AppError.internal('Failed to load broker account', { reason: brokerError.message });
    }
    const currency = ((broker?.currency as string | null) ?? '').trim() || DEFAULT_CURRENCY;

    const { data: policyData, error: policyError } = await db
      .from('broker_policies')
      .select('id, policy_type, premium_amount, status, start_date')
      .eq('broker_id', brokerId);
    if (policyError) {
      throw AppError.internal('Failed to load broker policies', { reason: policyError.message });
    }
    const policies = (policyData as ReportPolicyRow[] | null) ?? [];
    const policyIds = policies.map((p) => p.id);

    let claims: ReportClaimRow[] = [];
    let commissions: ReportCommissionRow[] = [];
    if (policyIds.length > 0) {
      const [claimResult, commissionResult] = await Promise.all([
        db.from('claims').select('status, claimed_amount').in('broker_policy_id', policyIds),
        db
          .from('commissions')
          .select('amount, status, scheduled_date, paid_date')
          .in('broker_policy_id', policyIds),
      ]);
      if (claimResult.error) {
        throw AppError.internal('Failed to load claims', { reason: claimResult.error.message });
      }
      if (commissionResult.error) {
        throw AppError.internal('Failed to load commissions', {
          reason: commissionResult.error.message,
        });
      }
      claims = (claimResult.data as ReportClaimRow[] | null) ?? [];
      commissions = (commissionResult.data as ReportCommissionRow[] | null) ?? [];
    }

    return { currency, policies, claims, commissions };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Build the AI portfolio input from the broker's clients + policies (R13). */
export function buildPortfolioSummary(
  brokerId: string,
  clients: ClientWithPoliciesRow[],
): PortfolioSummary {
  const policies: PortfolioPolicySummary[] = [];
  let totalPremium = 0;

  for (const client of clients) {
    for (const p of client.broker_policies ?? []) {
      const premium = toNumber(p.premium_amount);
      totalPremium += premium;
      policies.push({
        policyId: p.id,
        clientId: client.id,
        policyType: normalizeType(p.policy_type),
        premiumAmount: premium,
        sumInsured: p.sum_insured === null || p.sum_insured === undefined ? null : toNumber(p.sum_insured),
        analysis: null,
      });
    }
  }

  return {
    brokerId,
    totalClients: clients.length,
    totalPolicies: policies.length,
    totalPremium: round2(totalPremium),
    policies,
    riskCounts: countRisk(clients.map(toRiskInput)),
  };
}

/**
 * Derive coverage-gap insights from the broker's clients (R13.2). Gaps are
 * grouped by category so each insight references every affected client and
 * names the relevant coverage attribute plus an explanation (R13.4).
 */
export function buildCoverageGapInsights(
  clients: ClientWithPoliciesRow[],
  generatedAtIso: string,
): Insight[] {
  // category → { clientIds, label }
  const byCategory = new Map<RiskCategory, { clientIds: Set<string>; label: string }>();

  for (const client of clients) {
    const gaps: CoverageGap[] = deriveCoverageGaps(toRiskInput(client));
    for (const gap of gaps) {
      const entry = byCategory.get(gap.type) ?? { clientIds: new Set<string>(), label: gap.label };
      entry.clientIds.add(client.id);
      byCategory.set(gap.type, entry);
    }
  }

  const insights: Insight[] = [];
  for (const [category, entry] of byCategory.entries()) {
    const clientIds = [...entry.clientIds];
    insights.push({
      type: 'coverage_improvement',
      message: `${clientIds.length} client(s) have a coverage gap: ${entry.label}.`,
      clientIds,
      evidence: { gap: category, attribute: entry.label, affectedClients: clientIds.length },
      generatedAt: generatedAtIso,
    });
  }

  return insights;
}

/** Map a client row into the risk-input shape used by clientLogic helpers. */
function toRiskInput(client: ClientWithPoliciesRow): ClientRiskInput {
  return {
    riskFlags: toRiskFlags(client.risk_flags),
    policies: (client.broker_policies ?? []).map((p) => ({
      policyType: normalizeType(p.policy_type),
      deductible: p.deductible === null || p.deductible === undefined ? null : toNumber(p.deductible),
      endDate: p.end_date,
    })),
  };
}

/** Map a persisted `ai_insights` row into the camel-cased view. */
function mapInsightRow(row: AiInsightRow): InsightView {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    clientIds: row.client_ids ?? [],
    evidence: row.evidence,
    generatedAt: row.generated_at,
  };
}

/** The newest `generated_at` across cached rows, or null. */
function latestTimestamp(rows: AiInsightRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.generated_at && (latest === null || row.generated_at > latest)) {
      latest = row.generated_at;
    }
  }
  return latest;
}

/** True when `generatedAtIso` is within the refresh window relative to `now`. */
function isFresh(generatedAtIso: string, now: Date): boolean {
  const generated = new Date(generatedAtIso);
  if (Number.isNaN(generated.getTime())) return false;
  return now.getTime() - generated.getTime() < INSIGHT_REFRESH_MS;
}

/** Coerce a numeric/string/null DB value to a finite number (0 when absent). */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Trim a policy type to a non-empty string, defaulting to `unknown`. */
function normalizeType(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

/** Trim a status to a non-empty string, defaulting to `unknown`. */
function normalizeStatus(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
}
