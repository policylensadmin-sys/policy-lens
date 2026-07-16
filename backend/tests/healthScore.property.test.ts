// Property-based tests for the deterministic Health Score algorithm (R3.8).
//
// Task 5.7 — validates the two CRITICAL invariants documented in
// `src/services/policy/healthScore.ts`:
//   * BOUNDS       — computeHealthScore returns an integer in [0, 100] for ANY
//                    valid PolicyAnalysis.
//   * MONOTONICITY — adding an exclusion, or increasing/adding a co-pay, NEVER
//                    raises the score.
// Plus a boundary check that qualityBand maps scores to the correct bands.
//
// Validates: Requirements 3.8

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  POLICY_CATEGORIES,
  RECOMMENDATION_KINDS,
  RISK_LEVELS,
  PolicyAnalysisSchema,
  type CoPay,
  type Exclusion,
  type PolicyAnalysis,
} from '@policylens/shared';
import { computeHealthScore, qualityBand } from '../src/services/policy/healthScore';

// ---------------------------------------------------------------------------
// Arbitraries — build valid PolicyAnalysis objects that satisfy
// PolicyAnalysisSchema.
// ---------------------------------------------------------------------------

/** A finite non-negative money amount. */
const amountArb = fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true });

/** A finite percentage in [0, 100] (co-pay percent). */
const percentArb = fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });

const moneyArb = fc.record({
  amount: amountArb,
  currency: fc.constantFrom('INR', 'USD', 'EUR'),
});

const coverageArb = fc.record({
  type: fc.string(),
  detail: fc.string(),
  covered: fc.boolean(),
});

const exclusionArb: fc.Arbitrary<Exclusion> = fc.record({
  name: fc.string(),
  explanation: fc.string(),
});

/** A free-text duration such as "2 years", "24 months", "90 days". */
const durationArb = fc
  .tuple(
    fc.double({ min: 0, max: 60, noNaN: true, noDefaultInfinity: true }),
    fc.constantFrom('years', 'months', 'weeks', 'days', ''),
  )
  .map(([n, unit]) => `${n} ${unit}`.trim());

const waitingPeriodArb = fc.record({
  duration: durationArb,
  appliesTo: fc.string(),
});

const financialLimitArb = fc.record(
  {
    name: fc.string(),
    value: amountArb,
    unit: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: ['name', 'value'] },
);

const coPayArb: fc.Arbitrary<CoPay> = fc.record(
  {
    percent: percentArb,
    condition: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: ['percent'] },
);

const deductibleArb = fc.record({ amount: amountArb });

const hiddenClauseArb = fc.record({
  clause: fc.string(),
  risk: fc.constantFrom(...RISK_LEVELS),
  impact: fc.string(),
});

const recommendationArb = fc.record({
  kind: fc.constantFrom(...RECOMMENDATION_KINDS),
  title: fc.string(),
  detail: fc.string(),
});

/**
 * A fully-formed, schema-valid PolicyAnalysis. Every array field is ALWAYS
 * generated (never omitted): the `PolicyAnalysis` type is the Zod `.default([])`
 * *output* type, so those arrays are always present on a real analysis and
 * `computeHealthScore` relies on that contract. Only `category` is genuinely
 * optional (it may be `undefined`).
 */
const policyAnalysisArb: fc.Arbitrary<PolicyAnalysis> = fc.record({
  category: fc.option(fc.constantFrom(...POLICY_CATEGORIES), { nil: undefined }),
  provider: fc.string(),
  premium: moneyArb,
  sumInsured: amountArb,
  coverage: fc.array(coverageArb, { maxLength: 8 }),
  exclusions: fc.array(exclusionArb, { maxLength: 8 }),
  waitingPeriods: fc.array(waitingPeriodArb, { maxLength: 6 }),
  financialLimits: fc.array(financialLimitArb, { maxLength: 6 }),
  coPay: fc.array(coPayArb, { maxLength: 5 }),
  deductibles: fc.array(deductibleArb, { maxLength: 4 }),
  hiddenClauses: fc.array(hiddenClauseArb, { maxLength: 6 }),
  recommendations: fc.array(recommendationArb, { maxLength: 5 }),
  notFound: fc.array(fc.string(), { maxLength: 4 }),
  partial: fc.boolean(),
}) as fc.Arbitrary<PolicyAnalysis>;

// ---------------------------------------------------------------------------
// Property: BOUNDS
// ---------------------------------------------------------------------------

describe('computeHealthScore — Property BOUNDS', () => {
  it('generated analyses satisfy PolicyAnalysisSchema', () => {
    fc.assert(
      fc.property(policyAnalysisArb, (analysis) => {
        expect(PolicyAnalysisSchema.safeParse(analysis).success).toBe(true);
      }),
    );
  });

  it('returns an integer in [0, 100] for ANY analysis', () => {
    fc.assert(
      fc.property(policyAnalysisArb, (analysis) => {
        const score = computeHealthScore(analysis);
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property: MONOTONICITY (exclusions)
// ---------------------------------------------------------------------------

describe('computeHealthScore — Property MONOTONICITY (exclusions)', () => {
  it('adding one exclusion never increases the score', () => {
    fc.assert(
      fc.property(policyAnalysisArb, exclusionArb, (analysis, extra) => {
        const before = computeHealthScore(analysis);
        const after = computeHealthScore({
          ...analysis,
          exclusions: [...analysis.exclusions, extra],
        });
        expect(after).toBeLessThanOrEqual(before);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property: MONOTONICITY (co-pay)
// ---------------------------------------------------------------------------

describe('computeHealthScore — Property MONOTONICITY (co-pay)', () => {
  it('increasing an existing co-pay percent never increases the score', () => {
    fc.assert(
      fc.property(
        // Ensure at least one co-pay entry exists to increase.
        policyAnalysisArb.filter((a) => a.coPay.length > 0),
        fc.nat(),
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        (analysis, idxSeed, delta) => {
          const idx = idxSeed % analysis.coPay.length;
          const before = computeHealthScore(analysis);
          const bumped = analysis.coPay.map((cp, i) =>
            i === idx ? { ...cp, percent: cp.percent + delta } : cp,
          );
          const after = computeHealthScore({ ...analysis, coPay: bumped });
          expect(after).toBeLessThanOrEqual(before);
        },
      ),
    );
  });

  it('adding a co-pay never increases the score', () => {
    fc.assert(
      fc.property(policyAnalysisArb, coPayArb, (analysis, extra) => {
        const before = computeHealthScore(analysis);
        const after = computeHealthScore({
          ...analysis,
          coPay: [...analysis.coPay, extra],
        });
        expect(after).toBeLessThanOrEqual(before);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// qualityBand boundary mapping (R4.3)
// ---------------------------------------------------------------------------

describe('qualityBand — boundary mapping', () => {
  it('maps scores to the correct bands at the boundaries', () => {
    expect(qualityBand(0)).toBe('Poor');
    expect(qualityBand(40)).toBe('Poor');
    expect(qualityBand(41)).toBe('Fair');
    expect(qualityBand(60)).toBe('Fair');
    expect(qualityBand(61)).toBe('Good');
    expect(qualityBand(80)).toBe('Good');
    expect(qualityBand(81)).toBe('Excellent');
    expect(qualityBand(100)).toBe('Excellent');
  });

  it('every computed score maps to a valid band', () => {
    fc.assert(
      fc.property(policyAnalysisArb, (analysis) => {
        const band = qualityBand(computeHealthScore(analysis));
        expect(['Poor', 'Fair', 'Good', 'Excellent']).toContain(band);
      }),
    );
  });
});
