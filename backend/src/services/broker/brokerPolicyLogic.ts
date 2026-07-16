// Broker policy logic — pure, side-effect-free helpers (R11).
//
// This module holds the deterministic business rules for broker policy
// management, kept free of Supabase/HTTP concerns so they can be unit-tested in
// isolation:
//
//   • display-status derivation for a policy (Active | Pending Renewal |
//     Expired | Cancelled) from its stored status + end date (R11.1),
//   • required-field + date-order validation for adding/editing policies
//     (R11.1/R11.6),
//   • pagination bounds (≤50 policies per page, R11.1),
//   • renewal-calendar classification (due within 90 days, distinct <30-day
//     indicator, R11.2/R11.3),
//   • renewal-reminder recipient selection + delivery summary (R11.5/R11.7),
//   • premium-tracker aggregation: collection status + trailing-12-month chart
//     by insurance type (R11.4).
//
// The `BrokerPolicyService` composes these with Supabase reads/writes.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of policies returned per page (R11.1). */
export const POLICIES_PER_PAGE = 50;

/** Renewal-calendar horizon: renewals due within this many days (R11.2). */
export const RENEWAL_CALENDAR_WINDOW_DAYS = 90;

/** Renewals within this many days get a visually distinct "due soon" flag (R11.3). */
export const RENEWAL_DUE_SOON_DAYS = 30;

/** Number of trailing months in the premium-tracker chart (R11.4). */
export const PREMIUM_TRACKER_MONTHS = 12;

/** Required fields for creating a policy (R11.1). */
export const REQUIRED_POLICY_FIELDS = [
  'clientId',
  'policyType',
  'insurer',
  'startDate',
  'endDate',
  'premiumAmount',
  'paymentFrequency',
] as const;

/** The four display statuses a policy can surface as (R11.1). */
export type PolicyDisplayStatus = 'Active' | 'Pending Renewal' | 'Expired' | 'Cancelled';

/** Collection status buckets for the premium tracker (R11.4). */
export type CollectionStatus = 'Paid' | 'Pending' | 'Overdue';

// ---------------------------------------------------------------------------
// Numeric / date helpers
// ---------------------------------------------------------------------------

/** Coerce a numeric/string/null DB value to a finite number (0 when absent). */
export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimal places, avoiding negative-zero. */
export function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Parse a `YYYY-MM-DD` (or ISO) date string to a Date, or null when invalid. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Midnight (UTC) timestamp for the given date. */
function startOfDayUtc(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole days from `now` until `dateIso` (may be negative when in the past).
 * Compares at day granularity in UTC so results are stable regardless of time.
 */
export function daysUntil(dateIso: string | null | undefined, now: Date): number | null {
  const target = parseDate(dateIso);
  if (!target) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDayUtc(target) - startOfDayUtc(now)) / msPerDay);
}

/** `YYYY-MM` month key for a date (UTC). */
function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Status derivation (R11.1)
// ---------------------------------------------------------------------------

/** Minimal policy shape needed to derive a display status. */
export interface PolicyStatusInput {
  /** Stored enum status (active | pending_renewal | expired | cancelled). */
  status: string | null | undefined;
  /** Policy end date (ISO / `YYYY-MM-DD`). */
  endDate: string | null | undefined;
}

/**
 * Derive the display status for a policy (R11.1).
 *
 * Precedence:
 *   1. A cancelled policy is always `Cancelled` regardless of dates.
 *   2. A policy whose end date has passed is `Expired`.
 *   3. A policy ending within the renewal window (≤30 days) — or already
 *      flagged `pending_renewal` — is `Pending Renewal`.
 *   4. Otherwise `Active`.
 */
export function derivePolicyStatus(policy: PolicyStatusInput, now: Date = new Date()): PolicyDisplayStatus {
  if (policy.status === 'cancelled') return 'Cancelled';

  const days = daysUntil(policy.endDate, now);
  if (days !== null) {
    if (days < 0) return 'Expired';
    if (days <= RENEWAL_DUE_SOON_DAYS) return 'Pending Renewal';
  }

  // No usable end date: fall back to the stored status.
  if (policy.status === 'expired') return 'Expired';
  if (policy.status === 'pending_renewal') return 'Pending Renewal';
  return 'Active';
}

// ---------------------------------------------------------------------------
// Validation (R11.1 / R11.6)
// ---------------------------------------------------------------------------

/** Raw body accepted when creating a policy. */
export interface NewPolicyInput {
  clientId?: unknown;
  policyType?: unknown;
  insurer?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  premiumAmount?: unknown;
  paymentFrequency?: unknown;
  sumInsured?: unknown;
  deductible?: unknown;
}

/** Fields that may be edited on an existing policy. */
export interface EditPolicyInput extends NewPolicyInput {
  status?: unknown;
}

/** Result of validating a policy request (R11.1/R11.6). */
export interface PolicyValidationResult {
  valid: boolean;
  /** Names of required fields that are missing/blank, for the 422 details. */
  missingFields: string[];
  /** True when both dates are present and the end date precedes the start (R11.6). */
  endDateBeforeStart: boolean;
}

/** True when a value is a non-empty, non-whitespace string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when a value can be read as a finite number (R11.1 premium amount). */
function isNumericLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim().length > 0) return Number.isFinite(Number(value));
  return false;
}

/** True when a value parses to a valid calendar date. */
function isValidDateValue(value: unknown): boolean {
  return typeof value === 'string' && parseDate(value) !== null;
}

/** Check whether `endDate` precedes `startDate` (both must be valid dates). */
export function isEndBeforeStart(startDate: unknown, endDate: unknown): boolean {
  const start = typeof startDate === 'string' ? parseDate(startDate) : null;
  const end = typeof endDate === 'string' ? parseDate(endDate) : null;
  if (!start || !end) return false;
  return startOfDayUtc(end) < startOfDayUtc(start);
}

/**
 * Validate a create-policy request (R11.1/R11.6). Every required field must be
 * present, the premium amount must be numeric, both dates must be valid, and
 * the end date must not precede the start date. Returns the list of missing
 * fields plus the end-before-start flag so the caller can surface a 422 naming
 * the specific failure while the client preserves the entered data (R11.6).
 */
export function validateNewPolicy(body: NewPolicyInput): PolicyValidationResult {
  const missingFields: string[] = [];

  if (!isNonEmptyString(body.clientId)) missingFields.push('clientId');
  if (!isNonEmptyString(body.policyType)) missingFields.push('policyType');
  if (!isNonEmptyString(body.insurer)) missingFields.push('insurer');
  if (!isValidDateValue(body.startDate)) missingFields.push('startDate');
  if (!isValidDateValue(body.endDate)) missingFields.push('endDate');
  if (!isNumericLike(body.premiumAmount)) missingFields.push('premiumAmount');
  if (!isNonEmptyString(body.paymentFrequency)) missingFields.push('paymentFrequency');

  const endDateBeforeStart = isEndBeforeStart(body.startDate, body.endDate);

  return {
    valid: missingFields.length === 0 && !endDateBeforeStart,
    missingFields,
    endDateBeforeStart,
  };
}

/** The current persisted core fields of a policy, used to validate an edit. */
export interface PolicyCoreFields {
  clientId: string;
  policyType: string;
  insurer: string | null;
  startDate: string | null;
  endDate: string | null;
  premiumAmount: number | null;
  paymentFrequency: string | null;
}

/**
 * Validate an edit against the merged record (R11.1/R11.6). Any field the caller
 * omits keeps its current value; the merged record must still satisfy every
 * required field and the end date must not precede the start date.
 */
export function validatePolicyEdit(
  current: PolicyCoreFields,
  patch: EditPolicyInput,
): PolicyValidationResult {
  const pick = <T>(patchValue: unknown, currentValue: T): unknown =>
    patchValue === undefined ? currentValue : patchValue;

  const merged: NewPolicyInput = {
    clientId: pick(patch.clientId, current.clientId),
    policyType: pick(patch.policyType, current.policyType),
    insurer: pick(patch.insurer, current.insurer),
    startDate: pick(patch.startDate, current.startDate),
    endDate: pick(patch.endDate, current.endDate),
    premiumAmount: pick(patch.premiumAmount, current.premiumAmount),
    paymentFrequency: pick(patch.paymentFrequency, current.paymentFrequency),
  };

  return validateNewPolicy(merged);
}

// ---------------------------------------------------------------------------
// Pagination (R11.1)
// ---------------------------------------------------------------------------

/** Zero-based DB range + normalized page metadata for a page request. */
export interface PageBounds {
  /** 1-based normalized page number (clamped to ≥1). */
  page: number;
  /** Page size (always {@link POLICIES_PER_PAGE}). */
  pageSize: number;
  /** Inclusive start index for a Supabase `.range()` query. */
  from: number;
  /** Inclusive end index for a Supabase `.range()` query. */
  to: number;
}

/**
 * Normalize an arbitrary requested page into DB range bounds capped at 50 rows
 * per page (R11.1). Invalid/negative pages clamp to page 1.
 */
export function pageBounds(requestedPage: unknown, pageSize: number = POLICIES_PER_PAGE): PageBounds {
  const raw = typeof requestedPage === 'number' ? requestedPage : Number(requestedPage);
  const page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

/** Total number of pages for a row count at the given page size (≥1). */
export function totalPages(totalCount: number, pageSize: number = POLICIES_PER_PAGE): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

// ---------------------------------------------------------------------------
// Renewal calendar (R11.2 / R11.3)
// ---------------------------------------------------------------------------

/** Classification of a single renewal date relative to `now`. */
export interface RenewalClassification {
  /** Whole days from today until the renewal date (may be negative). */
  daysUntil: number | null;
  /** True when the renewal falls within the 90-day calendar window (R11.2). */
  withinWindow: boolean;
  /** True when the renewal is due within 30 days — distinct indicator (R11.3). */
  dueSoon: boolean;
}

/**
 * Classify a renewal date for the calendar (R11.2/R11.3). A renewal is in-window
 * when it is between today and 90 days out (inclusive); it is `dueSoon` when it
 * is within 30 days (used for the distinct visual indicator).
 */
export function classifyRenewal(
  renewalDate: string | null | undefined,
  now: Date = new Date(),
): RenewalClassification {
  const days = daysUntil(renewalDate, now);
  if (days === null) {
    return { daysUntil: null, withinWindow: false, dueSoon: false };
  }
  const withinWindow = days >= 0 && days <= RENEWAL_CALENDAR_WINDOW_DAYS;
  const dueSoon = withinWindow && days <= RENEWAL_DUE_SOON_DAYS;
  return { daysUntil: days, withinWindow, dueSoon };
}

// ---------------------------------------------------------------------------
// Renewal reminders (R11.5 / R11.7)
// ---------------------------------------------------------------------------

/** A renewal candidate considered for reminder delivery. */
export interface ReminderCandidate {
  renewalId: string;
  clientId: string;
  clientName: string;
  /** Client contact used for delivery; missing/blank makes delivery fail (R11.7). */
  contact: string | null;
  renewalDate: string | null;
}

/** A recipient whose reminder could not be delivered (for retry, R11.7). */
export interface FailedRecipient {
  renewalId: string;
  clientId: string;
  clientName: string;
  reason: string;
}

/** Outcome of a reminder run: what to mark sent, the count, and failures. */
export interface ReminderPlan {
  /** Renewal ids that were successfully delivered and should be marked sent. */
  sentRenewalIds: string[];
  /** Confirmation count of reminders sent (R11.5). */
  sentCount: number;
  /** Recipients that failed delivery, surfaced for retry (R11.7). */
  failed: FailedRecipient[];
}

/**
 * Normalize the broker-selected reminder window into a clamped day count. Falls
 * back to the 30-day default and never exceeds the 90-day calendar horizon.
 */
export function normalizeReminderWindow(withinDays: unknown): number {
  const raw = typeof withinDays === 'number' ? withinDays : Number(withinDays);
  if (!Number.isFinite(raw) || raw <= 0) return RENEWAL_DUE_SOON_DAYS;
  return Math.min(Math.floor(raw), RENEWAL_CALENDAR_WINDOW_DAYS);
}

/**
 * Plan a reminder run (R11.5/R11.7). Selects candidates whose renewal is due
 * within `withinDays`, treats those with a usable contact as delivered, and
 * reports the rest as failed recipients so the broker can retry. Pure: the
 * service performs the actual `reminder_sent` writes for `sentRenewalIds`.
 */
export function planRenewalReminders(
  candidates: ReminderCandidate[],
  withinDays: number,
  now: Date = new Date(),
): ReminderPlan {
  const sentRenewalIds: string[] = [];
  const failed: FailedRecipient[] = [];

  for (const candidate of candidates) {
    const days = daysUntil(candidate.renewalDate, now);
    const inWindow = days !== null && days >= 0 && days <= withinDays;
    if (!inWindow) continue;

    if (isNonEmptyString(candidate.contact)) {
      sentRenewalIds.push(candidate.renewalId);
    } else {
      failed.push({
        renewalId: candidate.renewalId,
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        reason: 'No contact information on file',
      });
    }
  }

  return { sentRenewalIds, sentCount: sentRenewalIds.length, failed };
}

// ---------------------------------------------------------------------------
// Premium tracker (R11.4)
// ---------------------------------------------------------------------------

/** A policy row as consumed by the premium tracker. */
export interface PremiumTrackerPolicy {
  policyType: string | null;
  premiumAmount: number | string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Collection-status totals: count + summed premium per bucket (R11.4). */
export interface CollectionSummary {
  paid: { count: number; amount: number };
  pending: { count: number; amount: number };
  overdue: { count: number; amount: number };
}

/** One month bucket of the premium chart, broken down by insurance type (R11.4). */
export interface PremiumMonthPoint {
  /** Month key in `YYYY-MM` form (chronological). */
  month: string;
  /** Total premium recorded for the month. */
  total: number;
  /** Premium by insurance type (`policy_type` → amount) for the month. */
  byType: Record<string, number>;
}

/** Full premium-tracker payload (R11.4). */
export interface PremiumTracker {
  collection: CollectionSummary;
  months: PremiumMonthPoint[];
  /** All insurance types appearing anywhere in the window (stable order). */
  types: string[];
  /** True when there is no premium data at all (empty-state). */
  empty: boolean;
}

/** Map a derived display status to its premium collection bucket (R11.4). */
export function toCollectionStatus(displayStatus: PolicyDisplayStatus): CollectionStatus | null {
  switch (displayStatus) {
    case 'Active':
      return 'Paid';
    case 'Pending Renewal':
      return 'Pending';
    case 'Expired':
      return 'Overdue';
    case 'Cancelled':
      return null; // Cancelled premiums are excluded from collection tracking.
  }
}

/**
 * Aggregate the premium tracker (R11.4): collection status (Paid/Pending/
 * Overdue) counts + amounts, plus a trailing-12-month chart bucketed by
 * insurance type. Premium is attributed to the month of the policy's start
 * date, mirroring the dashboard premium chart.
 */
export function computePremiumTracker(
  policies: PremiumTrackerPolicy[],
  now: Date = new Date(),
): PremiumTracker {
  const collection: CollectionSummary = {
    paid: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
    overdue: { count: 0, amount: 0 },
  };

  // Build ordered month buckets ending with the current month.
  const buckets: PremiumMonthPoint[] = [];
  const index = new Map<string, PremiumMonthPoint>();
  for (let i = PREMIUM_TRACKER_MONTHS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    const point: PremiumMonthPoint = { month: key, total: 0, byType: {} };
    buckets.push(point);
    index.set(key, point);
  }

  const types = new Set<string>();
  let hasData = false;

  for (const p of policies) {
    const amount = toNumber(p.premiumAmount);
    const displayStatus = derivePolicyStatus({ status: p.status, endDate: p.endDate }, now);

    // Cancelled policies are excluded from both collection tracking and the
    // premium chart — their premium is never collected.
    const bucket = toCollectionStatus(displayStatus);
    if (bucket === null) continue;

    // Collection status buckets.
    if (amount > 0) {
      const key = bucket.toLowerCase() as 'paid' | 'pending' | 'overdue';
      collection[key].count += 1;
      collection[key].amount = round2(collection[key].amount + amount);
      hasData = true;
    }

    // Monthly chart bucketed by insurance type.
    const start = parseDate(p.startDate);
    if (!start || amount <= 0) continue;
    const point = index.get(monthKey(start));
    if (!point) continue; // Outside the 12-month window.
    const type = p.policyType?.trim() || 'unknown';
    types.add(type);
    point.byType[type] = round2((point.byType[type] ?? 0) + amount);
    point.total = round2(point.total + amount);
    hasData = true;
  }

  return {
    collection,
    months: buckets,
    types: [...types].sort(),
    empty: !hasData,
  };
}
