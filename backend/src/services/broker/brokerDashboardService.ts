// BrokerDashboardService — dashboard aggregation for the broker portal (R9).
//
// Resolves the broker account for the authenticated broker profile and
// aggregates the dashboard payload consumed by `GET /api/broker/dashboard`:
//
//   • KPIs (R9.1)            — Total Premium (calendar YTD), Active Policies,
//                              Total Clients, Renewals Due (next 30 days),
//                              Pending Claims (under_review | pending).
//   • Premium Collection (R9.2) — monthly series for the last 12 months with a
//                              per-insurance-type breakdown.
//   • Commission Overview (R9.3) — total / paid / pending / overdue amounts,
//                              each rounded to 2 decimals in the broker's
//                              configured currency. "Overdue" is derived as any
//                              unpaid commission more than 30 days past its
//                              scheduled payment date.
//   • AI insights (R13.1)    — a lightweight list of the broker's most recent
//                              `ai_insights` rows (full generation is task 9.6).
//
// Zero counts, zero amounts, and an empty premium chart are returned when the
// broker has no data (R9.6). Aggregation runs in code over broker-scoped rows
// fetched via the service-role client (bypasses RLS); the controller is
// responsible for authenticating + authorizing the broker first.

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';

/** Window (days) used for the "Renewals Due" KPI (R9.1). */
const RENEWALS_DUE_WINDOW_DAYS = 30;

/** Days past a commission's scheduled date before it is considered overdue (R9.3). */
const COMMISSION_OVERDUE_DAYS = 30;

/** Number of trailing months in the premium-collection chart (R9.2). */
const PREMIUM_CHART_MONTHS = 12;

/** Claim statuses counted as "pending" for the KPI (R9.1). */
const PENDING_CLAIM_STATUSES = ['under_review', 'pending'] as const;

/** Max number of recent AI insights surfaced on the dashboard (R13.1, minimal). */
const MAX_DASHBOARD_INSIGHTS = 5;

/** Fallback currency when the broker has none configured. */
const DEFAULT_CURRENCY = 'INR';

/** Headline counts/amounts shown across the top of the dashboard (R9.1). */
export interface DashboardKpis {
  totalPremiumYtd: number;
  activePolicies: number;
  totalClients: number;
  renewalsDue: number;
  pendingClaims: number;
}

/** One month bucket of the premium-collection chart, broken down by type (R9.2). */
export interface PremiumMonthPoint {
  /** Month key in `YYYY-MM` form (chronological). */
  month: string;
  /** Total premium for the month across all insurance types. */
  total: number;
  /** Premium by insurance type (`policy_type` → amount) for the month. */
  byType: Record<string, number>;
}

/** Monthly premium series plus whether any data exists (R9.2, R9.6). */
export interface PremiumCollection {
  months: PremiumMonthPoint[];
  /** All insurance types appearing anywhere in the window (stable order). */
  types: string[];
  /** True when the window contains no premium at all (empty-state, R9.6). */
  empty: boolean;
}

/** Commission totals, each rounded to 2 decimals, in the broker's currency (R9.3). */
export interface CommissionOverview {
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  currency: string;
}

/** Lightweight AI insight summary for the dashboard strip (R13.1). */
export interface DashboardInsight {
  id: string;
  type: string;
  message: string;
  clientIds: string[];
  generatedAt: string | null;
}

/** Full dashboard payload returned to the broker portal. */
export interface BrokerDashboard {
  brokerId: string;
  currency: string;
  kpis: DashboardKpis;
  premiumCollection: PremiumCollection;
  commission: CommissionOverview;
  insights: DashboardInsight[];
}

/** Minimal shapes of the broker-domain rows this service reads. */
interface BrokerRow {
  id: string;
  currency: string | null;
}
interface BrokerPolicyRow {
  id: string;
  policy_type: string | null;
  premium_amount: number | string | null;
  status: string | null;
  start_date: string | null;
}
interface RenewalRow {
  renewal_date: string | null;
}
interface CommissionRow {
  amount: number | string | null;
  status: string | null;
  scheduled_date: string | null;
  paid_date: string | null;
}
interface ClaimRow {
  status: string | null;
}
interface AiInsightRow {
  id: string;
  type: string;
  message: string;
  client_ids: string[] | null;
  generated_at: string | null;
}

/**
 * Aggregates the broker dashboard payload (R9). Inject a {@link SupabaseClient}
 * for testing; in production it lazily resolves the service-role client.
 */
export class BrokerDashboardService {
  private client?: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client;
  }

  /** Resolve the Supabase client lazily (service-role by default). */
  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  /**
   * Build the dashboard for the broker owned by `brokerProfileId`
   * (`brokers.profile_id`). Uses `now` as the reference "today" (defaults to
   * the current time) so the time-windowed KPIs are deterministic in tests.
   *
   * @throws {AppError} 404 when no broker account exists for the profile.
   */
  async getDashboard(brokerProfileId: string, now: Date = new Date()): Promise<BrokerDashboard> {
    const broker = await this.resolveBroker(brokerProfileId);
    const currency = broker.currency?.trim() || DEFAULT_CURRENCY;

    // Fetch all broker-scoped rows in parallel. Renewals, commissions, and
    // claims are child tables joined via broker_policies, so we scope them by
    // the broker's policy ids.
    const [policies, clientCount] = await Promise.all([
      this.fetchPolicies(broker.id),
      this.fetchClientCount(broker.id),
    ]);

    const policyIds = policies.map((p) => p.id);
    const [renewals, commissions, claims, insights] = await Promise.all([
      this.fetchRenewals(policyIds),
      this.fetchCommissions(policyIds),
      this.fetchClaims(policyIds),
      this.fetchRecentInsights(broker.id),
    ]);

    return {
      brokerId: broker.id,
      currency,
      kpis: computeKpis(policies, clientCount, renewals, claims, now),
      premiumCollection: computePremiumCollection(policies, now),
      commission: computeCommissionOverview(commissions, currency, now),
      insights,
    };
  }

  /** Load the broker account tied to the profile, or 404. */
  private async resolveBroker(brokerProfileId: string): Promise<BrokerRow> {
    const { data, error } = await this.db()
      .from('brokers')
      .select('id, currency')
      .eq('profile_id', brokerProfileId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load broker account', { reason: error.message });
    }
    if (!data?.id) {
      throw AppError.notFound('No broker account found for the authenticated user');
    }
    return { id: data.id as string, currency: (data.currency as string | null) ?? null };
  }

  private async fetchPolicies(brokerId: string): Promise<BrokerPolicyRow[]> {
    const { data, error } = await this.db()
      .from('broker_policies')
      .select('id, policy_type, premium_amount, status, start_date')
      .eq('broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load broker policies', { reason: error.message });
    }
    return (data as BrokerPolicyRow[] | null) ?? [];
  }

  private async fetchClientCount(brokerId: string): Promise<number> {
    const { count, error } = await this.db()
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load clients', { reason: error.message });
    }
    return count ?? 0;
  }

  private async fetchRenewals(policyIds: string[]): Promise<RenewalRow[]> {
    if (policyIds.length === 0) return [];
    const { data, error } = await this.db()
      .from('renewals')
      .select('renewal_date')
      .in('broker_policy_id', policyIds);

    if (error) {
      throw AppError.internal('Failed to load renewals', { reason: error.message });
    }
    return (data as RenewalRow[] | null) ?? [];
  }

  private async fetchCommissions(policyIds: string[]): Promise<CommissionRow[]> {
    if (policyIds.length === 0) return [];
    const { data, error } = await this.db()
      .from('commissions')
      .select('amount, status, scheduled_date, paid_date')
      .in('broker_policy_id', policyIds);

    if (error) {
      throw AppError.internal('Failed to load commissions', { reason: error.message });
    }
    return (data as CommissionRow[] | null) ?? [];
  }

  private async fetchClaims(policyIds: string[]): Promise<ClaimRow[]> {
    if (policyIds.length === 0) return [];
    const { data, error } = await this.db()
      .from('claims')
      .select('status')
      .in('broker_policy_id', policyIds);

    if (error) {
      throw AppError.internal('Failed to load claims', { reason: error.message });
    }
    return (data as ClaimRow[] | null) ?? [];
  }

  private async fetchRecentInsights(brokerId: string): Promise<DashboardInsight[]> {
    const { data, error } = await this.db()
      .from('ai_insights')
      .select('id, type, message, client_ids, generated_at')
      .eq('broker_id', brokerId)
      .order('generated_at', { ascending: false, nullsFirst: false })
      .limit(MAX_DASHBOARD_INSIGHTS);

    if (error) {
      throw AppError.internal('Failed to load AI insights', { reason: error.message });
    }
    return ((data as AiInsightRow[] | null) ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      clientIds: row.client_ids ?? [],
      generatedAt: row.generated_at,
    }));
  }
}

// ---------------------------------------------------------------------------
// Pure aggregation helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Coerce a numeric/string/null DB value to a finite number (0 when absent). */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimal places, avoiding negative-zero (R9.3 currency amounts). */
export function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Parse a `YYYY-MM-DD` (or ISO) date string to a Date, or null when invalid. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `YYYY-MM` month key for a date (UTC). */
function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Compute the KPI counts/amounts (R9.1). */
export function computeKpis(
  policies: BrokerPolicyRow[],
  clientCount: number,
  renewals: RenewalRow[],
  claims: ClaimRow[],
  now: Date,
): DashboardKpis {
  const currentYear = now.getUTCFullYear();

  // Total Premium — calendar year-to-date: policies starting this year.
  let totalPremiumYtd = 0;
  let activePolicies = 0;
  for (const p of policies) {
    if (p.status === 'active') activePolicies += 1;
    const start = parseDate(p.start_date);
    if (start && start.getUTCFullYear() === currentYear && start.getTime() <= now.getTime()) {
      totalPremiumYtd += toNumber(p.premium_amount);
    }
  }

  // Renewals Due — renewal_date within [now, now + 30 days].
  const windowEnd = new Date(now.getTime());
  windowEnd.setUTCDate(windowEnd.getUTCDate() + RENEWALS_DUE_WINDOW_DAYS);
  let renewalsDue = 0;
  for (const r of renewals) {
    const d = parseDate(r.renewal_date);
    if (d && d.getTime() >= startOfDay(now) && d.getTime() <= windowEnd.getTime()) {
      renewalsDue += 1;
    }
  }

  const pendingClaims = claims.filter(
    (c) => c.status !== null && (PENDING_CLAIM_STATUSES as readonly string[]).includes(c.status),
  ).length;

  return {
    totalPremiumYtd: round2(totalPremiumYtd),
    activePolicies,
    totalClients: clientCount,
    renewalsDue,
    pendingClaims,
  };
}

/** Midnight (UTC) timestamp for the given date. */
function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Build the trailing-12-month premium series with a per-type breakdown (R9.2).
 * Returns zero-filled buckets and `empty: true` when there is no premium in the
 * window (empty-state indication, R9.6).
 */
export function computePremiumCollection(
  policies: BrokerPolicyRow[],
  now: Date,
): PremiumCollection {
  // Build the ordered list of month keys ending with the current month.
  const buckets: PremiumMonthPoint[] = [];
  const index = new Map<string, PremiumMonthPoint>();
  for (let i = PREMIUM_CHART_MONTHS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    const point: PremiumMonthPoint = { month: key, total: 0, byType: {} };
    buckets.push(point);
    index.set(key, point);
  }

  const types = new Set<string>();
  let hasData = false;

  for (const p of policies) {
    const start = parseDate(p.start_date);
    if (!start) continue;
    const point = index.get(monthKey(start));
    if (!point) continue; // Outside the 12-month window.
    const amount = toNumber(p.premium_amount);
    if (amount === 0) continue;
    const type = p.policy_type?.trim() || 'unknown';
    types.add(type);
    point.byType[type] = round2((point.byType[type] ?? 0) + amount);
    point.total = round2(point.total + amount);
    hasData = true;
  }

  return {
    months: buckets,
    types: [...types].sort(),
    empty: !hasData,
  };
}

/**
 * Aggregate commission totals (R9.3). "Overdue" is any unpaid commission more
 * than 30 days past its scheduled payment date (or explicitly flagged overdue);
 * "pending" is the remaining unpaid amount. All amounts rounded to 2 decimals.
 */
export function computeCommissionOverview(
  commissions: CommissionRow[],
  currency: string,
  now: Date,
): CommissionOverview {
  let total = 0;
  let paid = 0;
  let pending = 0;
  let overdue = 0;

  const overdueCutoff = new Date(now.getTime());
  overdueCutoff.setUTCDate(overdueCutoff.getUTCDate() - COMMISSION_OVERDUE_DAYS);

  for (const c of commissions) {
    const amount = toNumber(c.amount);
    total += amount;

    if (c.status === 'paid' || c.paid_date) {
      paid += amount;
      continue;
    }

    // Unpaid: classify as overdue when explicitly flagged or past the cutoff.
    const scheduled = parseDate(c.scheduled_date);
    const isOverdue =
      c.status === 'overdue' ||
      (scheduled !== null && scheduled.getTime() < overdueCutoff.getTime());

    if (isOverdue) {
      overdue += amount;
    } else {
      pending += amount;
    }
  }

  return {
    total: round2(total),
    paid: round2(paid),
    pending: round2(pending),
    overdue: round2(overdue),
    currency,
  };
}
