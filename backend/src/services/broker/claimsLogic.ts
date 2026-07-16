// Broker claims logic — pure, side-effect-free helpers (R12).
//
// This module holds the deterministic business rules for broker claims
// management, kept free of Supabase/HTTP concerns so they can be unit-tested in
// isolation:
//
//   • claim-status narrowing/validation (R12.1/R12.2),
//   • pagination bounds (≤50 claims per page, R12.1),
//   • claim search/filter matching by status / client / policy type / date
//     range (R12.3),
//   • Claim Assistant required-information validation, preventing submission
//     when required fields are missing (R12.4/R12.5).
//
// The `ClaimsService` composes these with Supabase reads/writes.

import { CLAIM_STATUSES, type ClaimStatus } from '@policylens/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of claims returned per page (R12.1). */
export const CLAIMS_PER_PAGE = 50;

/** Required information the Claim Assistant collects before submission (R12.4). */
export const REQUIRED_CLAIM_FIELDS = [
  'policyId',
  'incidentDate',
  'description',
  'supportingDocuments',
] as const;

// ---------------------------------------------------------------------------
// Status helpers (R12.1 / R12.2)
// ---------------------------------------------------------------------------

/** Narrow an arbitrary value to a known {@link ClaimStatus}, or `undefined`. */
export function toClaimStatus(value: unknown): ClaimStatus | undefined {
  return (CLAIM_STATUSES as readonly string[]).includes(value as string)
    ? (value as ClaimStatus)
    : undefined;
}

// ---------------------------------------------------------------------------
// Pagination (R12.1)
// ---------------------------------------------------------------------------

/** Zero-based DB range + normalized page metadata for a claims page request. */
export interface ClaimPageBounds {
  /** 1-based normalized page number (clamped to ≥1). */
  page: number;
  /** Page size (always {@link CLAIMS_PER_PAGE}). */
  pageSize: number;
  /** Inclusive start index for a Supabase `.range()` query. */
  from: number;
  /** Inclusive end index for a Supabase `.range()` query. */
  to: number;
}

/**
 * Normalize an arbitrary requested page into DB range bounds capped at 50 rows
 * per page (R12.1). Invalid/non-positive pages clamp to page 1.
 */
export function claimPageBounds(
  requestedPage: unknown,
  pageSize: number = CLAIMS_PER_PAGE,
): ClaimPageBounds {
  const raw = typeof requestedPage === 'number' ? requestedPage : Number(requestedPage);
  const page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

/** Total number of pages for a row count at the given page size (≥1). */
export function claimTotalPages(totalCount: number, pageSize: number = CLAIMS_PER_PAGE): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

// ---------------------------------------------------------------------------
// Filtering (R12.3)
// ---------------------------------------------------------------------------

/** Filters accepted by the claims list endpoint (R12.3). */
export interface ClaimFilters {
  /** Match claims in this status. */
  status?: ClaimStatus;
  /** Match claims belonging to this client id. */
  clientId?: string;
  /** Match claims whose policy is of this insurance type (case-insensitive). */
  policyType?: string;
  /** Inclusive lower bound on the submission date (`YYYY-MM-DD` / ISO). */
  from?: string;
  /** Inclusive upper bound on the submission date (`YYYY-MM-DD` / ISO). */
  to?: string;
}

/** The claim shape the filter predicate needs. */
export interface FilterableClaim {
  status: ClaimStatus;
  clientId: string;
  policyType: string | null;
  submittedAt: string | null;
}

/** Day-granularity (UTC) timestamp for an ISO date, or null when invalid. */
function dayStamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Decide whether a claim matches all provided filters (R12.3). An unset filter
 * is ignored; a set filter must match. The date range is compared at day
 * granularity (inclusive on both ends); a claim with no submission date never
 * matches a date-bounded filter.
 */
export function claimMatchesFilters(claim: FilterableClaim, filters: ClaimFilters): boolean {
  if (filters.status && claim.status !== filters.status) return false;

  if (filters.clientId && claim.clientId !== filters.clientId) return false;

  if (filters.policyType && filters.policyType.trim().length > 0) {
    const wanted = filters.policyType.trim().toLowerCase();
    if ((claim.policyType ?? '').toLowerCase() !== wanted) return false;
  }

  const from = dayStamp(filters.from);
  const to = dayStamp(filters.to);
  if (from !== null || to !== null) {
    const submitted = dayStamp(claim.submittedAt);
    if (submitted === null) return false;
    if (from !== null && submitted < from) return false;
    if (to !== null && submitted > to) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Claim Assistant validation (R12.4 / R12.5)
// ---------------------------------------------------------------------------

/** Raw body accepted when submitting a claim via the Claim Assistant. */
export interface ClaimSubmissionInput {
  /** Selected broker policy the claim is filed against. */
  policyId?: unknown;
  /** Date the insured incident occurred. */
  incidentDate?: unknown;
  /** Free-text description of the incident. */
  description?: unknown;
  /** Supporting document references/uploads (at least one required). */
  supportingDocuments?: unknown;
  /** Optional claim type / claimed amount captured by the workflow. */
  claimType?: unknown;
  claimedAmount?: unknown;
}

/** Result of validating a Claim Assistant submission (R12.4/R12.5). */
export interface ClaimValidationResult {
  valid: boolean;
  /** Names of required fields that are missing/blank, for the 422 details. */
  missingFields: string[];
}

/** True when a value is a non-empty, non-whitespace string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when a value is a non-empty list of supporting documents. */
function hasSupportingDocuments(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => entry !== null && entry !== undefined && entry !== '');
}

/**
 * Validate a Claim Assistant submission (R12.4). Every step's required
 * information — policy selection, incident date, incident description, and at
 * least one supporting document — must be present. Returns the list of missing
 * required fields so the caller can prevent submission and surface a 422 naming
 * exactly which fields require completion (R12.5).
 */
export function validateClaimSubmission(body: ClaimSubmissionInput): ClaimValidationResult {
  const missingFields: string[] = [];

  if (!isNonEmptyString(body.policyId)) missingFields.push('policyId');
  if (!isNonEmptyString(body.incidentDate)) missingFields.push('incidentDate');
  if (!isNonEmptyString(body.description)) missingFields.push('description');
  if (!hasSupportingDocuments(body.supportingDocuments)) missingFields.push('supportingDocuments');

  return { valid: missingFields.length === 0, missingFields };
}
