/**
 * Frontend view-model types for the broker portal, mirroring the backend
 * payloads returned by the `/api/broker/*` surface (see
 * `backend/src/services/broker/*`). Kept local to the frontend so the broker
 * components stay decoupled from the server module layout.
 */

import type { ClaimStatus } from '@policylens/shared';

/** Headline KPI counts/amounts across the top of the dashboard (R9.1). */
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

/** Lightweight AI insight summary for the dashboard strip (R13.1, R13.4). */
export interface DashboardInsight {
  id: string;
  type: string;
  message: string;
  clientIds: string[];
  generatedAt: string | null;
}

/** Full dashboard payload returned by `GET /api/broker/dashboard` (R9, R13.1). */
export interface BrokerDashboard {
  brokerId: string;
  currency: string;
  kpis: DashboardKpis;
  premiumCollection: PremiumCollection;
  commission: CommissionOverview;
  insights: DashboardInsight[];
}

/** One entry in the renewal calendar (R11.2/R11.3). */
export interface RenewalCalendarEntry {
  renewalId: string;
  policyId: string;
  clientId: string;
  clientName: string | null;
  policyType: string | null;
  insurer: string | null;
  renewalDate: string | null;
  premiumAmount: number | null;
  daysUntil: number | null;
  /** True when due within 30 days — distinct calendar indicator (R11.3). */
  dueSoon: boolean;
}

/** Renewal calendar payload from `GET /api/broker/renewals` (R11.2/R11.3). */
export interface RenewalCalendar {
  windowDays: number;
  dueSoonDays: number;
  entries: RenewalCalendarEntry[];
}

/** A recipient whose renewal reminder could not be delivered, for retry (R11.7). */
export interface ReminderFailedRecipient {
  renewalId: string;
  clientId: string;
  clientName: string;
  reason: string;
}

/**
 * Confirmation summary returned by `POST /api/broker/renewals/remind`
 * (R11.5/R11.7): how many reminders were sent plus any failed recipients.
 */
export interface ReminderSummary {
  windowDays: number;
  sentCount: number;
  failed: ReminderFailedRecipient[];
}

/** Count + summed premium for one collection-status bucket (R11.4). */
export interface CollectionBucket {
  count: number;
  amount: number;
}

/** Collection-status totals across the three buckets (R11.4). */
export interface CollectionSummary {
  paid: CollectionBucket;
  pending: CollectionBucket;
  overdue: CollectionBucket;
}

/**
 * Premium tracker payload from `GET /api/broker/premiums` (R11.4): collection
 * status buckets plus a trailing-12-month chart broken down by insurance type.
 */
export interface PremiumTracker {
  collection: CollectionSummary;
  months: PremiumMonthPoint[];
  /** All insurance types appearing anywhere in the window (stable order). */
  types: string[];
  /** True when there is no premium data at all (empty-state, R11.4). */
  empty: boolean;
}

/**
 * Default currency used to render premium amounts on pages whose endpoint does
 * not carry a currency (renewals / premiums). Mirrors the backend broker
 * default; commission figures use the currency returned by their endpoint.
 */
export const DEFAULT_BROKER_CURRENCY = 'INR';

/** The five risk categories tracked by the Client Risk Dashboard (R10.3). */
export type RiskCategory =
  | 'underinsured'
  | 'missing_family_coverage'
  | 'high_deductible'
  | 'waiting_period_ending'
  | 'no_health_insurance';

/** Aggregate counts across a broker's clients for the Risk Dashboard (R10.3). */
export type RiskCounts = Record<RiskCategory, number>;

/** Response body from `GET /api/broker/clients/risk` (R10.3). */
export interface RiskDashboardResponse {
  counts: RiskCounts;
}

// ---------------------------------------------------------------------------
// Reports (GET /api/broker/reports, R19.7)
// ---------------------------------------------------------------------------

/** Policy-volume aggregation: total plus counts by type and status (R19.7). */
export interface PolicyVolume {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

/** Premium-revenue aggregation: total plus revenue by insurance type (R19.7). */
export interface PremiumRevenue {
  total: number;
  byType: Record<string, number>;
}

/** Claims-activity aggregation: total, counts by status, claimed amount (R19.7). */
export interface ClaimsActivity {
  total: number;
  byStatus: Record<string, number>;
  totalClaimedAmount: number;
}

/** Reports payload from `GET /api/broker/reports` (R19.7). */
export interface BrokerReports {
  brokerId: string;
  currency: string;
  policyVolume: PolicyVolume;
  premiumRevenue: PremiumRevenue;
  claimsActivity: ClaimsActivity;
  commission: CommissionOverview;
}

// ---------------------------------------------------------------------------
// Analytics (GET /api/broker/analytics, R19.7)
// ---------------------------------------------------------------------------

/** One slice of the portfolio policy mix by insurance type (R19.7). */
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

/** Analytics payload from `GET /api/broker/analytics` (R19.7). */
export interface BrokerAnalytics {
  brokerId: string;
  currency: string;
  /** Trailing-12-month premium series broken down by insurance type (R19.7). */
  premiumTrend: PremiumCollection;
  policyMix: PolicyMixSlice[];
  claims: ClaimsBreakdown;
  commission: CommissionOverview;
}

// ---------------------------------------------------------------------------
// Documents (GET/POST/DELETE /api/broker/documents, R19.6)
// ---------------------------------------------------------------------------

/** A stored broker document, optionally categorized by client/policy (R19.6). */
export interface DocumentView {
  id: string;
  brokerId: string;
  clientId: string | null;
  brokerPolicyId: string | null;
  name: string;
  storagePath: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response body from `GET /api/broker/documents` (R19.6). */
export interface DocumentsResponse {
  documents: DocumentView[];
}

// ---------------------------------------------------------------------------
// Team (GET/POST/DELETE /api/broker/team, R19.5)
// ---------------------------------------------------------------------------

/** A broker team member with a role-based permission map (R19.5). */
export interface TeamMemberView {
  id: string;
  brokerId: string;
  name: string;
  role: string | null;
  permissions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Response body from `GET /api/broker/team` (R19.5). */
export interface TeamResponse {
  team: TeamMemberView[];
}

// ---------------------------------------------------------------------------
// Client management view-models (R10) — mirror `ClientService` payloads.
// ---------------------------------------------------------------------------

/** A human-readable coverage gap shown on a client profile (R10.2). */
export interface CoverageGap {
  type: RiskCategory;
  label: string;
}

/** Boolean membership across each risk category for a single client (R10.3). */
export type ClientRisk = Record<RiskCategory, boolean>;

/** A policy row as returned within a client profile/list payload (R10.2). */
export interface ClientPolicyView {
  id: string;
  policyType: string;
  insurer: string | null;
  startDate: string | null;
  endDate: string | null;
  premiumAmount: number | null;
  paymentFrequency: string | null;
  status: string;
  sumInsured: number | null;
  deductible: number | null;
}

/** A client as returned in list/profile payloads (R10.1/R10.2). */
export interface ClientView {
  id: string;
  brokerId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  riskFlags: string[];
  policies: ClientPolicyView[];
  coverageGaps: CoverageGap[];
  risk: ClientRisk;
  createdAt: string;
  updatedAt: string;
}

/** Response body from `GET /api/broker/clients` (R10.1/R10.4). */
export interface ClientListResponse {
  clients: ClientView[];
}

/** Response body from `GET/POST/PUT /api/broker/clients(/:id)` (R10.1/R10.2). */
export interface ClientResponse {
  client: ClientView;
}

// ---------------------------------------------------------------------------
// Policy management view-models (R11) — mirror `BrokerPolicyService` payloads.
// ---------------------------------------------------------------------------

/** The four display statuses a policy can surface as (R11.1). */
export type PolicyDisplayStatus =
  | 'Active'
  | 'Pending Renewal'
  | 'Expired'
  | 'Cancelled';

/** A policy row as returned in the paginated list/detail payloads (R11.1). */
export interface PolicyView {
  id: string;
  clientId: string;
  clientName: string | null;
  policyType: string;
  insurer: string | null;
  startDate: string | null;
  endDate: string | null;
  premiumAmount: number | null;
  paymentFrequency: string | null;
  sumInsured: number | null;
  deductible: number | null;
  status: PolicyDisplayStatus;
  storedStatus: string;
}

/** Paginated policy list from `GET /api/broker/policies` (≤50/page, R11.1). */
export interface PolicyPage {
  policies: PolicyView[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** Response body from `POST/PUT /api/broker/policies(/:id)` (R11.1/R11.6). */
export interface PolicyResponse {
  policy: PolicyView;
}

/** Structured `422` validation detail returned by the broker policy API (R11.6). */
export interface PolicyValidationDetails {
  missingFields?: string[];
  endDateBeforeStart?: boolean;
}

/** Structured `422` validation detail returned by the broker client API (R10.5). */
export interface ClientValidationDetails {
  missingFields?: string[];
}

/** Format a short human date, or an em dash when absent/invalid. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a monetary amount in the broker's configured currency. Falls back to
 * a plain number with the code when the currency is not recognised. Always
 * renders 2 decimal places for commission figures (R9.3).
 */
export function formatMoney(
  amount: number,
  currency: string,
  fractionDigits = 2,
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })}`;
  }
}

/**
 * Compact money for KPI cards where 2 decimals add noise on large totals
 * (e.g. YTD premium). Uses no fraction digits.
 */
export function formatMoneyCompact(amount: number, currency: string): string {
  return formatMoney(amount, currency, 0);
}

/** Human-friendly label for an insurance/policy type or insight type key. */
export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert a `YYYY-MM` month key to a short label (e.g. `Jan 24`). */
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map((n) => Number.parseInt(n, 10));
  if (!year || !month) {
    return monthKey;
  }
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

// ---------------------------------------------------------------------------
// Claims (R12) — mirrors `ClaimsService.ClaimView` / `ClaimPage`.
// ---------------------------------------------------------------------------

/** A claim row as returned by `GET /api/broker/claims` (R12.1). */
export interface ClaimView {
  id: string;
  clientId: string;
  clientName: string | null;
  policyId: string;
  /** Policy reference shown as the "policy number" in the claims table (R12.1). */
  policyNumber: string;
  policyType: string | null;
  insurer: string | null;
  claimType: string;
  claimedAmount: number | null;
  status: ClaimStatus;
  submittedAt: string | null;
}

/** Paginated claims list payload (≤50/page) with the empty-results flag (R12.1/R12.3). */
export interface ClaimListResponse {
  claims: ClaimView[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  /** True when no claims match the active filters (R12.3). */
  noResults: boolean;
}

/** Human labels for each claim status (R12.1). */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  approved: 'Approved',
  under_review: 'Under Review',
  pending: 'Pending',
  rejected: 'Rejected',
};

/** Badge styling per claim status (broker light theme). */
export const CLAIM_STATUS_STYLES: Record<ClaimStatus, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  under_review: 'bg-amber-100 text-amber-700',
  pending: 'bg-slate-100 text-slate-600',
  rejected: 'bg-rose-100 text-rose-700',
};

// ---------------------------------------------------------------------------
// Broker policies (R11) — the subset needed to select a policy in the Claim
// Assistant (mirrors `BrokerPolicyService.PolicyView`).
// ---------------------------------------------------------------------------

/** A broker-managed policy row (fields used by the claims/leads screens). */
export interface BrokerPolicyView {
  id: string;
  clientId: string;
  clientName: string | null;
  policyType: string | null;
  insurer: string | null;
  startDate: string | null;
  endDate: string | null;
  premiumAmount: number | null;
  paymentFrequency: string | null;
  sumInsured: number | null;
  deductible: number | null;
  status: string;
  storedStatus: string;
}

/** Paginated broker-policy list payload from `GET /api/broker/policies`. */
export interface BrokerPolicyListResponse {
  policies: BrokerPolicyView[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Leads (R19.4) — mirrors `BrokerCrmService.LeadView`.
// ---------------------------------------------------------------------------

/** A lead row as returned by `GET /api/broker/leads` (R19.4). */
export interface LeadView {
  id: string;
  brokerId: string;
  name: string;
  contact: string | null;
  stage: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// AI insights (R13) — mirrors `InsightsService.InsightView` / `InsightsResult`.
// ---------------------------------------------------------------------------

/** A single categorized insight as returned by `GET /api/broker/insights` (R13.3/13.4). */
export interface InsightView {
  id?: string;
  type: string;
  message: string;
  clientIds: string[];
  evidence?: unknown;
  generatedAt: string | null;
}

/**
 * Full insights payload (R13). When `available` is false the list is empty and
 * `lastGeneratedAt` carries the last successful generation timestamp so the
 * portal can show the "temporarily unavailable" notice (R13.5).
 */
export interface InsightsResult {
  available: boolean;
  insights: InsightView[];
  generatedAt: string | null;
  lastGeneratedAt: string | null;
  message?: string;
}

/** Best-effort extraction of the "relevant attribute" from insight evidence (R13.4). */
export function insightAttribute(evidence: unknown): string | null {
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const record = evidence as Record<string, unknown>;
    const attribute = record.attribute ?? record.gap ?? record.label;
    if (typeof attribute === 'string' && attribute.trim().length > 0) {
      return humanizeKey(attribute.trim());
    }
  }
  return null;
}

/** Format an ISO timestamp for display, or null when absent/invalid. */
export function formatTimestamp(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
