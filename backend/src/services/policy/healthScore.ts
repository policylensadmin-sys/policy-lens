// HealthScoreService — deterministic weighted 0–100 policy health scoring (R3.8, R4.3).
//
// The Health Score is computed *in code* (never by the LLM) so it is fully
// reproducible and property-testable. Starting from a perfect 100 we subtract a
// set of penalties (coverage gaps, waiting periods, exclusions, restrictive
// financial limits, co-pay) and add a claim-friendliness bonus, then clamp the
// result into [0, 100] and round to an integer (the `policy_analysis.health_score`
// column is an int).
//
// All weights are named constants below so the algorithm is transparent and
// easy to tune.
//
// CRITICAL invariants (property-tested in task 5.7 with fast-check):
//   1. BOUNDS   — the output is ALWAYS an integer in [0, 100] for ANY input.
//   2. MONOTONIC — adding an exclusion, or increasing a co-pay percentage,
//      NEVER increases the score. This holds because:
//        * every penalty term is non-negative;
//        * the exclusion penalty is non-decreasing in the exclusion count
//          (each exclusion contributes >= EXCLUSION_BASE_PENALTY, capped);
//        * the co-pay penalty is non-decreasing in each co-pay percent
//          (capped);
//        * the claim-friendliness bonus depends ONLY on an (optional)
//          settlement ratio — never on exclusions or co-pay;
//        * clamping and rounding are both monotonic transforms.

import type { CoPay, Exclusion, FinancialLimit, PolicyAnalysis } from '@policylens/shared';

// ---------------------------------------------------------------------------
// Tuning constants (named weights).
// ---------------------------------------------------------------------------

/** The score everyone starts from before penalties/bonuses are applied. */
export const BASE_SCORE = 100;

/**
 * Core coverage types a healthy policy is expected to include. A missing core
 * type contributes {@link COVERAGE_GAP_PENALTY_PER_TYPE} to the coverage-gap
 * penalty. Compared case-insensitively as substrings against each covered
 * coverage line's `type`.
 */
export const CORE_COVERAGE_TYPES = [
  'hospitalization',
  'pre-hospitalization',
  'post-hospitalization',
  'day care',
  'ambulance',
] as const;

/** Penalty per missing core coverage type. */
export const COVERAGE_GAP_PENALTY_PER_TYPE = 6;
/** Upper bound on the total coverage-gap penalty. */
export const COVERAGE_GAP_PENALTY_MAX = 30;

/** Penalty per year of waiting period (summed across all waiting periods). */
export const WAITING_PERIOD_PENALTY_PER_YEAR = 4;
/** Upper bound on the total waiting-period penalty. */
export const WAITING_PERIOD_PENALTY_MAX = 20;

/** Flat penalty applied to every exclusion regardless of severity (> 0). */
export const EXCLUSION_BASE_PENALTY = 3;
/** Extra penalty added for a high-severity exclusion (keyword match). */
export const EXCLUSION_SEVERITY_PENALTY = 3;
/** Upper bound on the total exclusion penalty. */
export const EXCLUSION_PENALTY_MAX = 30;

/**
 * Keywords that mark an exclusion as high-severity (broad/common-need
 * exclusions that materially reduce real-world protection).
 */
export const HIGH_SEVERITY_EXCLUSION_KEYWORDS = [
  'pre-existing',
  'pregnancy',
  'maternity',
  'mental',
  'cancer',
  'war',
  'suicide',
  'cosmetic',
] as const;

/** Penalty per restrictive room/ICU sub-limit present. */
export const LIMIT_PENALTY_PER_RESTRICTIVE = 5;
/** Upper bound on the total limit penalty. */
export const LIMIT_PENALTY_MAX = 15;
/** Keywords identifying a room/ICU financial sub-limit. */
export const RESTRICTIVE_LIMIT_KEYWORDS = ['room', 'icu', 'bed', 'cap'] as const;

/** Penalty per percentage-point of co-pay (summed across all co-pay entries). */
export const COPAY_PENALTY_PER_PERCENT = 0.4;
/** Upper bound on the total co-pay penalty. */
export const COPAY_PENALTY_MAX = 20;

/**
 * Maximum claim-friendliness bonus, awarded in proportion to the claim
 * settlement ratio when one is available. The bonus depends ONLY on the
 * settlement ratio (never on exclusions or co-pay) to preserve monotonicity.
 */
export const CLAIM_FRIENDLINESS_BONUS_MAX = 10;

// ---------------------------------------------------------------------------
// Quality bands (R4.3).
// ---------------------------------------------------------------------------

/** A human-readable quality band derived from the numeric score. */
export type QualityBand = 'Poor' | 'Fair' | 'Good' | 'Excellent';

/**
 * Maps a 0–100 score to its quality band (R4.3):
 *   0–40 Poor · 41–60 Fair · 61–80 Good · 81–100 Excellent.
 * Inputs are clamped so out-of-range values still return a valid band.
 */
export function qualityBand(score: number): QualityBand {
  const s = clamp(score, 0, 100);
  if (s <= 40) return 'Poor';
  if (s <= 60) return 'Fair';
  if (s <= 80) return 'Good';
  return 'Excellent';
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic Health Score (0–100) for a policy analysis.
 *
 * @param analysis structured policy analysis (see {@link PolicyAnalysis}).
 * @returns an integer in [0, 100].
 */
export function computeHealthScore(analysis: PolicyAnalysis): number {
  const raw =
    BASE_SCORE -
    coverageGapPenalty(analysis.coverage) -
    waitingPeriodPenalty(analysis.waitingPeriods) -
    exclusionPenalty(analysis.exclusions) -
    limitPenalty(analysis.financialLimits) -
    coPayPenalty(analysis.coPay) +
    claimFriendlinessBonus(analysis);

  return Math.round(clamp(raw, 0, 100));
}

// ---------------------------------------------------------------------------
// Penalty / bonus components. Each returns a non-negative number.
// ---------------------------------------------------------------------------

/** Penalty for missing core coverage types (independent of exclusions/co-pay). */
function coverageGapPenalty(coverage: PolicyAnalysis['coverage']): number {
  const coveredTypes = coverage
    .filter((c) => c.covered)
    .map((c) => c.type.toLowerCase());

  const missing = CORE_COVERAGE_TYPES.filter(
    (core) => !coveredTypes.some((t) => t.includes(core)),
  ).length;

  return Math.min(missing * COVERAGE_GAP_PENALTY_PER_TYPE, COVERAGE_GAP_PENALTY_MAX);
}

/** Penalty scaling with total waiting time — longer waits cost more. */
function waitingPeriodPenalty(waitingPeriods: PolicyAnalysis['waitingPeriods']): number {
  const totalYears = waitingPeriods.reduce(
    (sum, wp) => sum + durationToYears(wp.duration),
    0,
  );
  const penalty = totalYears * WAITING_PERIOD_PENALTY_PER_YEAR;
  return Math.min(penalty, WAITING_PERIOD_PENALTY_MAX);
}

/**
 * Penalty for exclusions: count × severity. Every exclusion contributes at
 * least {@link EXCLUSION_BASE_PENALTY} (> 0), so the penalty is non-decreasing
 * in the number of exclusions — adding one never lowers the penalty (and thus
 * never raises the score). Capped at {@link EXCLUSION_PENALTY_MAX}.
 */
function exclusionPenalty(exclusions: Exclusion[]): number {
  const total = exclusions.reduce((sum, ex) => sum + exclusionSeverity(ex), 0);
  return Math.min(total, EXCLUSION_PENALTY_MAX);
}

/** Per-exclusion penalty: a positive base plus a bonus for high-severity terms. */
function exclusionSeverity(exclusion: Exclusion): number {
  const haystack = `${exclusion.name} ${exclusion.explanation}`.toLowerCase();
  const highSeverity = HIGH_SEVERITY_EXCLUSION_KEYWORDS.some((kw) =>
    haystack.includes(kw),
  );
  return EXCLUSION_BASE_PENALTY + (highSeverity ? EXCLUSION_SEVERITY_PENALTY : 0);
}

/** Penalty for restrictive room/ICU financial sub-limits. */
function limitPenalty(limits: FinancialLimit[]): number {
  const restrictive = limits.filter((limit) => {
    const name = limit.name.toLowerCase();
    return RESTRICTIVE_LIMIT_KEYWORDS.some((kw) => name.includes(kw));
  }).length;

  return Math.min(restrictive * LIMIT_PENALTY_PER_RESTRICTIVE, LIMIT_PENALTY_MAX);
}

/**
 * Penalty for co-payment: higher co-pay costs more. The penalty is
 * non-decreasing in each entry's `percent` (before the cap), so increasing any
 * co-pay percentage never lowers the penalty — and thus never raises the score.
 * Negative percentages are treated as 0. Capped at {@link COPAY_PENALTY_MAX}.
 */
function coPayPenalty(coPay: CoPay[]): number {
  const total = coPay.reduce(
    (sum, cp) => sum + Math.max(0, cp.percent) * COPAY_PENALTY_PER_PERCENT,
    0,
  );
  return Math.min(total, COPAY_PENALTY_MAX);
}

/**
 * Claim-friendliness bonus, proportional to the claim settlement ratio when
 * one is available on the analysis. Depends ONLY on the settlement ratio, so it
 * is invariant to exclusions and co-pay (preserving monotonicity). When no
 * ratio is available the bonus is 0.
 */
function claimFriendlinessBonus(analysis: PolicyAnalysis): number {
  const ratio = settlementRatio(analysis);
  if (ratio === undefined) return 0;
  // Normalise a ratio expressed either as a fraction (0–1) or a percentage
  // (0–100) into [0, 1], then scale by the max bonus.
  const normalised = ratio > 1 ? ratio / 100 : ratio;
  return clamp(normalised, 0, 1) * CLAIM_FRIENDLINESS_BONUS_MAX;
}

/**
 * Read an optional claim settlement ratio from the analysis if present. The
 * shared `PolicyAnalysis` type does not (yet) model this field, so we read it
 * defensively — "settlement ratio if available" (R3.8). Returns `undefined`
 * when absent or non-numeric.
 */
function settlementRatio(analysis: PolicyAnalysis): number | undefined {
  const candidate = (analysis as { claimSettlementRatio?: unknown }).claimSettlementRatio;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Best-effort parse of a free-text duration (e.g. "2 years", "24 months",
 * "90 days") into a number of years. Unparseable durations contribute 0 so they
 * never add a penalty. Never returns a negative value.
 */
function durationToYears(duration: string): number {
  const text = duration.toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  const raw = match?.[1];
  if (raw === undefined) return 0;

  const value = Math.max(0, parseFloat(raw));
  if (Number.isNaN(value)) return 0;

  if (text.includes('year')) return value;
  if (text.includes('month')) return value / 12;
  if (text.includes('week')) return value / 52;
  if (text.includes('day')) return value / 365;

  // Bare number with no recognised unit: assume years (common in policy text).
  return value;
}
