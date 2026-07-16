// Unit tests for broker validation + derived-metric helpers — gap coverage.
//
// The client (`brokerClients.test.ts`), policy (`brokerPolicyLogic.test.ts`),
// and dashboard (`brokerDashboard.test.ts`) suites already cover the bulk of
// R10/R11/R9. This suite fills the remaining gaps so the broker portal's
// validation + derived-metric surface is fully exercised:
//
//   • Claim Assistant required-information validation, preventing submission
//     when required fields are missing (R12.4/R12.5).
//   • Claims search/filter matching + pagination bounds (R12.1/R12.3).
//   • Robustness of the risk-flag normalization that feeds the Risk Dashboard
//     counts (R10.3).
//   • Shared derived-metric numeric helpers used for 2-decimal money rounding
//     (R9.3/R11.4).

import { describe, expect, it } from 'vitest';

import { toRiskFlags } from '../src/services/broker/clientLogic';
import {
  parseDate,
  round2 as policyRound2,
  toNumber,
} from '../src/services/broker/brokerPolicyLogic';
import {
  claimMatchesFilters,
  claimPageBounds,
  claimTotalPages,
  toClaimStatus,
  validateClaimSubmission,
  type FilterableClaim,
} from '../src/services/broker/claimsLogic';

// ---------------------------------------------------------------------------
// Claim Assistant validation — R12.4 / R12.5
// ---------------------------------------------------------------------------

describe('validateClaimSubmission (R12.4/R12.5)', () => {
  const validBody = {
    policyId: 'bp-1',
    incidentDate: '2024-05-01',
    description: 'Windshield cracked in a storm',
    supportingDocuments: ['doc-1'],
  };

  it('accepts a submission with all required information', () => {
    const result = validateClaimSubmission(validBody);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('names every missing required field so submission can be prevented', () => {
    const result = validateClaimSubmission({});
    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual([
      'policyId',
      'incidentDate',
      'description',
      'supportingDocuments',
    ]);
  });

  it('treats blank/whitespace strings as missing', () => {
    const result = validateClaimSubmission({
      ...validBody,
      policyId: '   ',
      description: '',
    });
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('policyId');
    expect(result.missingFields).toContain('description');
  });

  it('requires at least one non-empty supporting document', () => {
    expect(validateClaimSubmission({ ...validBody, supportingDocuments: [] }).missingFields).toContain(
      'supportingDocuments',
    );
    expect(
      validateClaimSubmission({ ...validBody, supportingDocuments: ['', null] }).missingFields,
    ).toContain('supportingDocuments');
    expect(
      validateClaimSubmission({ ...validBody, supportingDocuments: 'doc-1' }).missingFields,
    ).toContain('supportingDocuments');
  });
});

// ---------------------------------------------------------------------------
// Claims filtering + pagination — R12.1 / R12.3
// ---------------------------------------------------------------------------

describe('claimMatchesFilters (R12.3)', () => {
  const claim: FilterableClaim = {
    status: 'under_review',
    clientId: 'client-1',
    policyType: 'Motor',
    submittedAt: '2024-05-15T09:00:00.000Z',
  };

  it('matches when no filters are provided', () => {
    expect(claimMatchesFilters(claim, {})).toBe(true);
  });

  it('filters by status', () => {
    expect(claimMatchesFilters(claim, { status: 'under_review' })).toBe(true);
    expect(claimMatchesFilters(claim, { status: 'approved' })).toBe(false);
  });

  it('filters by client id', () => {
    expect(claimMatchesFilters(claim, { clientId: 'client-1' })).toBe(true);
    expect(claimMatchesFilters(claim, { clientId: 'client-2' })).toBe(false);
  });

  it('filters by policy type case-insensitively', () => {
    expect(claimMatchesFilters(claim, { policyType: 'motor' })).toBe(true);
    expect(claimMatchesFilters(claim, { policyType: 'health' })).toBe(false);
  });

  it('filters by an inclusive submission date range', () => {
    expect(claimMatchesFilters(claim, { from: '2024-05-01', to: '2024-05-31' })).toBe(true);
    expect(claimMatchesFilters(claim, { from: '2024-05-15', to: '2024-05-15' })).toBe(true); // inclusive
    expect(claimMatchesFilters(claim, { from: '2024-06-01' })).toBe(false);
    expect(claimMatchesFilters(claim, { to: '2024-05-01' })).toBe(false);
  });

  it('never matches a date-bounded filter when the claim has no submission date', () => {
    const undated: FilterableClaim = { ...claim, submittedAt: null };
    expect(claimMatchesFilters(undated, { from: '2024-01-01' })).toBe(false);
  });

  it('requires all provided filters to match (AND semantics)', () => {
    expect(claimMatchesFilters(claim, { status: 'under_review', clientId: 'client-2' })).toBe(false);
  });
});

describe('claim pagination (R12.1)', () => {
  it('caps page size at 50 and computes the DB range', () => {
    const bounds = claimPageBounds(1);
    expect(bounds.pageSize).toBe(50);
    expect(bounds.from).toBe(0);
    expect(bounds.to).toBe(49);
  });

  it('offsets by page', () => {
    const bounds = claimPageBounds(2);
    expect(bounds.from).toBe(50);
    expect(bounds.to).toBe(99);
  });

  it('clamps invalid pages to 1', () => {
    expect(claimPageBounds(0).page).toBe(1);
    expect(claimPageBounds(-3).page).toBe(1);
    expect(claimPageBounds('foo').page).toBe(1);
  });

  it('computes total pages', () => {
    expect(claimTotalPages(0)).toBe(1);
    expect(claimTotalPages(50)).toBe(1);
    expect(claimTotalPages(51)).toBe(2);
    expect(claimTotalPages(101)).toBe(3);
  });
});

describe('toClaimStatus (R12.1/R12.2)', () => {
  it('narrows known statuses and rejects unknown values', () => {
    expect(toClaimStatus('approved')).toBe('approved');
    expect(toClaimStatus('under_review')).toBe('under_review');
    expect(toClaimStatus('bogus')).toBeUndefined();
    expect(toClaimStatus(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Risk-flag normalization feeding the Risk Dashboard counts — R10.3
// ---------------------------------------------------------------------------

describe('toRiskFlags (R10.3)', () => {
  it('returns only the string entries of an array', () => {
    expect(toRiskFlags(['underinsured', 'high_deductible'])).toEqual([
      'underinsured',
      'high_deductible',
    ]);
  });

  it('filters out non-string entries', () => {
    expect(toRiskFlags(['underinsured', 42, null, { x: 1 }, 'missing_family_coverage'])).toEqual([
      'underinsured',
      'missing_family_coverage',
    ]);
  });

  it('returns an empty array for null/malformed values', () => {
    expect(toRiskFlags(null)).toEqual([]);
    expect(toRiskFlags(undefined)).toEqual([]);
    expect(toRiskFlags('underinsured')).toEqual([]);
    expect(toRiskFlags(123)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shared derived-metric numeric helpers — R9.3 / R11.4
// ---------------------------------------------------------------------------

describe('derived-metric numeric helpers (R9.3/R11.4)', () => {
  it('toNumber coerces numeric strings and falls back to 0', () => {
    expect(toNumber(1200)).toBe(1200);
    expect(toNumber('1500.5')).toBe(1500.5);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('not-a-number')).toBe(0);
  });

  it('round2 rounds money to 2 decimals and normalizes negative zero', () => {
    expect(policyRound2(1.005)).toBe(1.01);
    expect(policyRound2(2.344)).toBe(2.34);
    expect(policyRound2(-0)).toBe(0);
    expect(policyRound2(100)).toBe(100);
  });

  it('parseDate parses valid dates and rejects invalid ones', () => {
    expect(parseDate('2024-06-15')).toBeInstanceOf(Date);
    expect(parseDate(null)).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});
