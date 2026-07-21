import type { HiddenClause } from '@policylens/shared';

/**
 * Semantic severity styling + ordering for risk flags / hidden clauses (R4.2).
 *
 * Colors are intentionally light, high-contrast accent tints that sit on top of
 * the dark customer theme cards: High = red, Medium = orange, Low = amber.
 */

export type RiskLevel = HiddenClause['risk'];

/** Tailwind classes for a severity chip/badge (border + tinted background). */
export const RISK_SEVERITY_CLASSES: Record<RiskLevel, string> = {
  High: 'bg-red-100 text-red-700 border-red-300',
  Medium: 'bg-orange-100 text-orange-700 border-orange-300',
  Low: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Left accent bar color per severity, for the expandable clause rows. */
export const RISK_SEVERITY_ACCENT: Record<RiskLevel, string> = {
  High: 'border-l-red-400',
  Medium: 'border-l-orange-400',
  Low: 'border-l-amber-300',
};

/** Display weight so High sorts before Medium before Low (R4.2). */
const RISK_ORDER: Record<RiskLevel, number> = { High: 0, Medium: 1, Low: 2 };

/** Sort hidden clauses High → Medium → Low without mutating the input. */
export function sortBySeverity(clauses: HiddenClause[]): HiddenClause[] {
  return [...clauses].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
}
