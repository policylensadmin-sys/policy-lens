// Unit tests for broker client logic (R10) — risk categorization, Risk
// Dashboard counts, coverage-gap derivation, required-field validation, and
// search/filter matching. These exercise the pure rules in `clientLogic`
// (no Supabase / HTTP).

import { describe, expect, it } from 'vitest';

import {
  clientMatchesFilters,
  countRisk,
  daysUntil,
  deriveClientRisk,
  deriveCoverageGaps,
  toRiskCategory,
  validateClientEdit,
  validateNewClient,
  type ClientRiskInput,
  type FilterableClient,
} from '../src/services/broker/clientLogic';

// ---------------------------------------------------------------------------
// deriveClientRisk / countRisk — R10.3
// ---------------------------------------------------------------------------

describe('deriveClientRisk', () => {
  it('flags high deductible from policy data when a deductible exceeds ₹50,000', () => {
    const risk = deriveClientRisk({
      riskFlags: [],
      policies: [{ policyType: 'health', deductible: 60_000, endDate: null }],
    });
    expect(risk.high_deductible).toBe(true);
  });

  it('does not flag high deductible at exactly ₹50,000 (must exceed)', () => {
    const risk = deriveClientRisk({
      riskFlags: [],
      policies: [{ policyType: 'health', deductible: 50_000, endDate: null }],
    });
    expect(risk.high_deductible).toBe(false);
  });

  it('flags no health insurance when no policy is of type health', () => {
    const risk = deriveClientRisk({
      riskFlags: [],
      policies: [{ policyType: 'travel', deductible: 0, endDate: null }],
    });
    expect(risk.no_health_insurance).toBe(true);
  });

  it('does not flag no health insurance when a health policy exists', () => {
    const risk = deriveClientRisk({
      riskFlags: [],
      policies: [{ policyType: 'Health', deductible: 0, endDate: null }],
    });
    expect(risk.no_health_insurance).toBe(false);
  });

  it('reads underinsured, missing family coverage, and waiting period from risk flags', () => {
    const risk = deriveClientRisk({
      riskFlags: ['underinsured', 'missing_family_coverage', 'waiting_period_ending'],
      policies: [{ policyType: 'health', deductible: 0, endDate: null }],
    });
    expect(risk.underinsured).toBe(true);
    expect(risk.missing_family_coverage).toBe(true);
    expect(risk.waiting_period_ending).toBe(true);
  });
});

describe('countRisk', () => {
  it('counts distinct clients across each risk category', () => {
    const clients: ClientRiskInput[] = [
      // Ravi: high deductible (60k), has health.
      { riskFlags: ['high_deductible'], policies: [{ policyType: 'health', deductible: 60_000, endDate: null }] },
      // Priya: missing family coverage, has health.
      { riskFlags: ['missing_family_coverage'], policies: [{ policyType: 'health', deductible: 25_000, endDate: null }] },
      // Arjun: travel only → no health insurance.
      { riskFlags: [], policies: [{ policyType: 'travel', deductible: 0, endDate: null }] },
      // Meera: underinsured, has health + life.
      {
        riskFlags: ['underinsured', 'no_health_insurance'],
        policies: [
          { policyType: 'health', deductible: 40_000, endDate: null },
          { policyType: 'life', deductible: 0, endDate: null },
        ],
      },
    ];

    const counts = countRisk(clients);
    expect(counts.high_deductible).toBe(1); // Ravi only (>50k)
    expect(counts.missing_family_coverage).toBe(1); // Priya
    expect(counts.underinsured).toBe(1); // Meera
    expect(counts.no_health_insurance).toBe(1); // Arjun (derived; Meera has health)
    expect(counts.waiting_period_ending).toBe(0);
  });

  it('returns all-zero counts for no clients', () => {
    expect(countRisk([])).toEqual({
      underinsured: 0,
      missing_family_coverage: 0,
      high_deductible: 0,
      waiting_period_ending: 0,
      no_health_insurance: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// deriveCoverageGaps — R10.2
// ---------------------------------------------------------------------------

describe('deriveCoverageGaps', () => {
  it('produces a labeled gap for each active risk category', () => {
    const gaps = deriveCoverageGaps({
      riskFlags: ['underinsured'],
      policies: [{ policyType: 'travel', deductible: 60_000, endDate: null }],
    });
    const types = gaps.map((g) => g.type);
    expect(types).toContain('underinsured');
    expect(types).toContain('high_deductible');
    expect(types).toContain('no_health_insurance');
    // Each gap carries a human-readable label.
    expect(gaps.every((g) => g.label.length > 0)).toBe(true);
  });

  it('produces no gaps for a well-covered client', () => {
    const gaps = deriveCoverageGaps({
      riskFlags: [],
      policies: [{ policyType: 'health', deductible: 10_000, endDate: null }],
    });
    expect(gaps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateNewClient — R10.1 / R10.5
// ---------------------------------------------------------------------------

describe('validateNewClient', () => {
  it('accepts a client with all required fields and at least one policy', () => {
    const result = validateNewClient({
      fullName: 'Ravi Kumar',
      email: 'ravi@example.com',
      phone: '+91 98200 11111',
      policies: [{ policyType: 'health' }],
    });
    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('reports every missing required field by name', () => {
    const result = validateNewClient({ fullName: '   ', policies: [] });
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('fullName');
    expect(result.missingFields).toContain('email');
    expect(result.missingFields).toContain('phone');
    expect(result.missingFields).toContain('policies');
  });

  it('requires at least one associated policy', () => {
    const result = validateNewClient({
      fullName: 'A',
      email: 'a@example.com',
      phone: '123',
      policies: [],
    });
    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual(['policies']);
  });

  it('requires each associated policy to declare a policy type', () => {
    const result = validateNewClient({
      fullName: 'A',
      email: 'a@example.com',
      phone: '123',
      policies: [{ insurer: 'Star Health' }],
    });
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('policies[].policyType');
  });
});

// ---------------------------------------------------------------------------
// validateClientEdit — R10.1 / R10.5
// ---------------------------------------------------------------------------

describe('validateClientEdit', () => {
  const current = { fullName: 'Ravi', email: 'ravi@example.com', phone: '123' };

  it('accepts a partial patch that keeps required fields non-empty', () => {
    const result = validateClientEdit(current, { fullName: 'Ravi Kumar' });
    expect(result.valid).toBe(true);
  });

  it('rejects clearing a required field to blank', () => {
    const result = validateClientEdit(current, { email: '   ' });
    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual(['email']);
  });

  it('rejects when the current record is missing a required field and the patch does not fix it', () => {
    const result = validateClientEdit(
      { fullName: 'Ravi', email: null, phone: null },
      { fullName: 'Ravi Kumar' },
    );
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('email');
    expect(result.missingFields).toContain('phone');
  });
});

// ---------------------------------------------------------------------------
// clientMatchesFilters — R10.4
// ---------------------------------------------------------------------------

describe('clientMatchesFilters', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const client: FilterableClient = {
    fullName: 'Ravi Kumar',
    riskFlags: ['underinsured'],
    policies: [
      { policyType: 'health', deductible: 60_000, endDate: '2024-01-20', renewalDate: '2024-01-20' },
      { policyType: 'motor', deductible: 5_000, endDate: '2024-09-01' },
    ],
  };

  it('matches when no filters are provided', () => {
    expect(clientMatchesFilters(client, {}, now)).toBe(true);
  });

  it('matches a case-insensitive name substring', () => {
    expect(clientMatchesFilters(client, { name: 'ravi' }, now)).toBe(true);
    expect(clientMatchesFilters(client, { name: 'priya' }, now)).toBe(false);
  });

  it('matches by policy type', () => {
    expect(clientMatchesFilters(client, { policyType: 'motor' }, now)).toBe(true);
    expect(clientMatchesFilters(client, { policyType: 'travel' }, now)).toBe(false);
  });

  it('matches by risk category', () => {
    expect(clientMatchesFilters(client, { risk: 'underinsured' }, now)).toBe(true);
    expect(clientMatchesFilters(client, { risk: 'missing_family_coverage' }, now)).toBe(false);
  });

  it('matches when a policy renews within the requested window', () => {
    expect(clientMatchesFilters(client, { renewalWithinDays: 30 }, now)).toBe(true);
    expect(clientMatchesFilters(client, { renewalWithinDays: 10 }, now)).toBe(false);
  });

  it('requires all provided filters to match (AND semantics)', () => {
    expect(
      clientMatchesFilters(client, { name: 'ravi', policyType: 'travel' }, now),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

describe('daysUntil', () => {
  it('computes whole-day differences and returns null for invalid input', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    expect(daysUntil('2024-01-11', now)).toBe(10);
    expect(daysUntil('2023-12-22', now)).toBe(-10);
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil('not-a-date', now)).toBeNull();
  });
});

describe('toRiskCategory', () => {
  it('narrows known categories and rejects unknown values', () => {
    expect(toRiskCategory('high_deductible')).toBe('high_deductible');
    expect(toRiskCategory('bogus')).toBeUndefined();
    expect(toRiskCategory(undefined)).toBeUndefined();
  });
});
