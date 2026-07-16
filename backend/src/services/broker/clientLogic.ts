// Broker client logic — pure, side-effect-free helpers (R10).
//
// This module holds the deterministic business rules for broker client
// management, kept free of Supabase/HTTP concerns so they can be unit-tested in
// isolation:
//
//   • risk categorization per client (R10.3),
//   • Client Risk Dashboard counts (R10.3),
//   • coverage-gap derivation shown on a client profile (R10.2),
//   • required-field validation for adding/editing clients (R10.1/R10.5),
//   • search/filter matching by name / policy type / risk / renewal (R10.4).
//
// The `ClientService` composes these with Supabase reads/writes.

/** Deductible above this rupee amount marks a "high deductible" policy (R10.3). */
export const HIGH_DEDUCTIBLE_THRESHOLD = 50_000;

/** Window (days) for "waiting periods ending soon" and renewal filtering (R10.3/R10.4). */
export const RENEWAL_WINDOW_DAYS = 30;

/** Risk-flag key indicating a client is underinsured (AI-identified, R10.3). */
export const FLAG_UNDERINSURED = 'underinsured';
/** Risk-flag key indicating a client is missing family coverage (R10.3). */
export const FLAG_MISSING_FAMILY_COVERAGE = 'missing_family_coverage';
/** Risk-flag key indicating a client has a waiting period ending soon (R10.3). */
export const FLAG_WAITING_PERIOD_ENDING = 'waiting_period_ending';

/** The five risk categories tracked by the Client Risk Dashboard (R10.3). */
export const RISK_CATEGORIES = [
  'underinsured',
  'missing_family_coverage',
  'high_deductible',
  'waiting_period_ending',
  'no_health_insurance',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

/** Minimal policy shape needed to derive a client's risk categories. */
export interface ClientPolicyLike {
  policyType: string;
  deductible: number | null;
  endDate: string | null;
  renewalDate?: string | null;
}

/** Minimal client shape needed to derive risk categories. */
export interface ClientRiskInput {
  riskFlags: string[];
  policies: ClientPolicyLike[];
}

/** Boolean membership across each risk category for a single client. */
export type ClientRisk = Record<RiskCategory, boolean>;

/** Aggregate counts across a set of clients for the Risk Dashboard (R10.3). */
export type RiskCounts = Record<RiskCategory, number>;

/**
 * Normalize an arbitrary `risk_flags` value (jsonb) into a string array so the
 * rules below are robust to `null`/malformed data.
 */
export function toRiskFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Derive the five risk categories for one client (R10.3).
 *
 *   • `high_deductible`     — any policy with deductible exceeding ₹50,000
 *                             (derived from policy data).
 *   • `no_health_insurance` — no associated policy of type `health`
 *                             (derived from policy data).
 *   • `underinsured` / `missing_family_coverage` / `waiting_period_ending`
 *                             — AI-identified, carried on the client's
 *                               `risk_flags`.
 */
export function deriveClientRisk(client: ClientRiskInput): ClientRisk {
  const flags = client.riskFlags;
  const policies = client.policies;

  const highDeductible = policies.some(
    (p) => typeof p.deductible === 'number' && p.deductible > HIGH_DEDUCTIBLE_THRESHOLD,
  );
  const noHealthInsurance = !policies.some(
    (p) => p.policyType.toLowerCase() === 'health',
  );

  return {
    underinsured: flags.includes(FLAG_UNDERINSURED),
    missing_family_coverage: flags.includes(FLAG_MISSING_FAMILY_COVERAGE),
    high_deductible: highDeductible,
    waiting_period_ending: flags.includes(FLAG_WAITING_PERIOD_ENDING),
    no_health_insurance: noHealthInsurance,
  };
}

/** Sum each risk category across all clients for the Risk Dashboard (R10.3). */
export function countRisk(clients: ClientRiskInput[]): RiskCounts {
  const counts: RiskCounts = {
    underinsured: 0,
    missing_family_coverage: 0,
    high_deductible: 0,
    waiting_period_ending: 0,
    no_health_insurance: 0,
  };
  for (const client of clients) {
    const risk = deriveClientRisk(client);
    for (const category of RISK_CATEGORIES) {
      if (risk[category]) counts[category] += 1;
    }
  }
  return counts;
}

/** A human-readable coverage gap shown on a client profile (R10.2). */
export interface CoverageGap {
  type: RiskCategory;
  label: string;
}

const COVERAGE_GAP_LABELS: Record<RiskCategory, string> = {
  no_health_insurance: 'No health insurance coverage',
  underinsured: 'Underinsured relative to recommended cover',
  missing_family_coverage: 'Missing family coverage',
  high_deductible: 'High deductible policy (deductible exceeds ₹50,000)',
  waiting_period_ending: 'Waiting period ending within 30 days',
};

/**
 * Derive the coverage gaps for a client from its risk categories (R10.2).
 * Only categories that are true produce a gap entry.
 */
export function deriveCoverageGaps(client: ClientRiskInput): CoverageGap[] {
  const risk = deriveClientRisk(client);
  const gaps: CoverageGap[] = [];
  for (const category of RISK_CATEGORIES) {
    if (risk[category]) {
      gaps.push({ type: category, label: COVERAGE_GAP_LABELS[category] });
    }
  }
  return gaps;
}

/** A candidate policy supplied when adding a client. */
export interface NewClientPolicyInput {
  policyType?: unknown;
  insurer?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  premiumAmount?: unknown;
  paymentFrequency?: unknown;
  sumInsured?: unknown;
  deductible?: unknown;
}

/** Raw body accepted when creating a client. */
export interface NewClientInput {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  policies?: unknown;
  riskFlags?: unknown;
}

/** Result of validating a create-client request (R10.1/R10.5). */
export interface ClientValidationResult {
  valid: boolean;
  /** Field names that are required but missing/blank, for the 422 details. */
  missingFields: string[];
}

/** True when a value is a non-empty, non-whitespace string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a create-client request (R10.1): full name, email, phone number, and
 * at least one associated policy (each with a policy type) are required. Returns
 * the list of missing required fields so the caller can surface a 422 naming
 * exactly which fields are missing (R10.5).
 */
export function validateNewClient(body: NewClientInput): ClientValidationResult {
  const missingFields: string[] = [];

  if (!isNonEmptyString(body.fullName)) missingFields.push('fullName');
  if (!isNonEmptyString(body.email)) missingFields.push('email');
  if (!isNonEmptyString(body.phone)) missingFields.push('phone');

  const policies = Array.isArray(body.policies) ? (body.policies as NewClientPolicyInput[]) : [];
  if (policies.length === 0) {
    missingFields.push('policies');
  } else if (!policies.every((p) => isNonEmptyString(p?.policyType))) {
    // Every associated policy must at least declare its type.
    missingFields.push('policies[].policyType');
  }

  return { valid: missingFields.length === 0, missingFields };
}

/** Fields that may be edited on an existing client (R10.1). */
export interface EditClientInput {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  riskFlags?: unknown;
}

/** The merged core fields of a client used to validate an edit. */
export interface ClientCoreFields {
  fullName: string;
  email: string | null;
  phone: string | null;
}

/**
 * Validate an edit: any provided core field must remain non-empty, and the
 * merged record must still satisfy the required fields (R10.1/R10.5). Callers
 * pass the current record so partial updates are validated against final state.
 */
export function validateClientEdit(
  current: ClientCoreFields,
  patch: EditClientInput,
): ClientValidationResult {
  const merged = {
    fullName: patch.fullName === undefined ? current.fullName : patch.fullName,
    email: patch.email === undefined ? current.email : patch.email,
    phone: patch.phone === undefined ? current.phone : patch.phone,
  };

  const missingFields: string[] = [];
  if (!isNonEmptyString(merged.fullName)) missingFields.push('fullName');
  if (!isNonEmptyString(merged.email)) missingFields.push('email');
  if (!isNonEmptyString(merged.phone)) missingFields.push('phone');

  return { valid: missingFields.length === 0, missingFields };
}

/** Filters accepted by the client search endpoint (R10.4). */
export interface ClientFilters {
  /** Case-insensitive substring match on the client name. */
  name?: string;
  /** Match clients holding at least one policy of this type. */
  policyType?: string;
  /** Match clients in this risk category. */
  risk?: RiskCategory;
  /** Match clients with a policy renewing within this many days from `now`. */
  renewalWithinDays?: number;
}

/** Compute whole days from `now` until an ISO date string (may be negative). */
export function daysUntil(dateIso: string | null | undefined, now: Date): number | null {
  if (!dateIso) return null;
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfTarget = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  return Math.round((startOfTarget - startOfNow) / msPerDay);
}

/** The client shape the filter predicate needs (name + risk input + policies). */
export interface FilterableClient extends ClientRiskInput {
  fullName: string;
}

/**
 * Decide whether a client matches all provided filters (R10.4). An unset filter
 * is ignored; a set filter must match. Renewal matching considers each policy's
 * renewal date (falling back to its end date) being between today and the
 * window, inclusive.
 */
export function clientMatchesFilters(
  client: FilterableClient,
  filters: ClientFilters,
  now: Date = new Date(),
): boolean {
  if (filters.name && filters.name.trim().length > 0) {
    if (!client.fullName.toLowerCase().includes(filters.name.trim().toLowerCase())) {
      return false;
    }
  }

  if (filters.policyType && filters.policyType.trim().length > 0) {
    const wanted = filters.policyType.trim().toLowerCase();
    if (!client.policies.some((p) => p.policyType.toLowerCase() === wanted)) {
      return false;
    }
  }

  if (filters.risk) {
    const risk = deriveClientRisk(client);
    if (!risk[filters.risk]) return false;
  }

  if (typeof filters.renewalWithinDays === 'number') {
    const window = filters.renewalWithinDays;
    const hasUpcoming = client.policies.some((p) => {
      const days = daysUntil(p.renewalDate ?? p.endDate, now);
      return days !== null && days >= 0 && days <= window;
    });
    if (!hasUpcoming) return false;
  }

  return true;
}

/** Narrow an arbitrary query value to a known `RiskCategory`, or `undefined`. */
export function toRiskCategory(value: unknown): RiskCategory | undefined {
  return (RISK_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as RiskCategory)
    : undefined;
}
