import { useState } from 'react';
import type { HiddenClause } from '@policylens/shared';
import { RISK_SEVERITY_ACCENT, RISK_SEVERITY_CLASSES, sortBySeverity } from '../lib/riskSeverity';

/**
 * RiskFlagList — the actual flagged hidden clauses shown beneath the risk-flag
 * summary on the policy dashboard (R4.2).
 *
 * Each clause is a keyboard-accessible disclosure: clicking (or pressing
 * Enter/Space on) the header toggles a panel revealing the plain-English
 * `impact`. Clauses are colour-coded by severity (High = red, Medium = orange,
 * Low = amber) and ordered High → Medium → Low so the most serious risks lead.
 */

interface RiskFlagListProps {
  clauses: HiddenClause[];
}

export function RiskFlagList({ clauses }: RiskFlagListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (clauses.length === 0) return null;

  const ordered = sortBySeverity(clauses);

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((clause, index) => {
        const isOpen = openIndex === index;
        const panelId = `risk-flag-panel-${index}`;
        const buttonId = `risk-flag-button-${index}`;
        return (
          <li
            key={`${clause.clause}-${index}`}
            className={`overflow-hidden rounded-xl border border-l-4 border-border bg-surface ${RISK_SEVERITY_ACCENT[clause.risk]}`}
          >
            <button
              type="button"
              id={buttonId}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-background/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${RISK_SEVERITY_CLASSES[clause.risk]}`}
                >
                  {clause.risk}
                </span>
                <span className="truncate font-medium text-foreground">{clause.clause}</span>
              </span>
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
              </svg>
            </button>
            {isOpen && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="border-t border-border px-4 py-3"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  What this means
                </p>
                <p className="mt-1 text-sm text-foreground">{clause.impact}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default RiskFlagList;
