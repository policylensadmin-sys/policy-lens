import type { HiddenClause } from '@policylens/shared';

/**
 * ClauseCard — a single flagged clause rendered in plain English with its risk
 * badge (R4.1 risk flags, R3.7).
 *
 * Shows the clause text alongside a High/Medium/Low risk indicator and the
 * plain-English explanation of the impact on the policyholder.
 */

interface ClauseCardProps {
  clause: HiddenClause;
}

/** Tailwind classes for each risk level badge. */
const RISK_BADGE: Record<HiddenClause['risk'], string> = {
  High: 'border-danger/50 bg-danger/15 text-danger',
  Medium: 'border-amber-400/50 bg-amber-400/15 text-amber-400',
  Low: 'border-accent/50 bg-accent/15 text-accent',
};

export function ClauseCard({ clause }: ClauseCardProps) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-foreground">{clause.clause}</p>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${RISK_BADGE[clause.risk]}`}
        >
          {clause.risk} risk
        </span>
      </div>
      <p className="text-sm text-muted">{clause.impact}</p>
    </article>
  );
}

export default ClauseCard;
