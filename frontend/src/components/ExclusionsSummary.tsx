import type { Exclusion } from '@policylens/shared';

/**
 * ExclusionsSummary — exclusions summary showing the total exclusion count and
 * the top exclusions with their plain-English explanations (R4.1).
 */

/** How many exclusions to surface as "top" on the dashboard. */
export const TOP_EXCLUSIONS = 5;

interface ExclusionsSummaryProps {
  exclusions: Exclusion[];
  /** Message shown when no exclusions were identified (R3.9). */
  emptyMessage?: string;
}

export function ExclusionsSummary({
  exclusions,
  emptyMessage = 'No exclusions were identified in this policy.',
}: ExclusionsSummaryProps) {
  if (exclusions.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  const top = exclusions.slice(0, TOP_EXCLUSIONS);
  const remaining = exclusions.length - top.length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        <span className="font-display text-lg text-foreground">{exclusions.length}</span>{' '}
        exclusion{exclusions.length === 1 ? '' : 's'} found
      </p>
      <ul className="flex flex-col gap-2">
        {top.map((exclusion, index) => (
          <li
            key={`${exclusion.name}-${index}`}
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-rose-800">{exclusion.name}</p>
              <span className="shrink-0 rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                Not covered
              </span>
            </div>
            <p className="mt-1 text-xs text-rose-700/90">{exclusion.explanation}</p>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <p className="text-xs text-muted">
          + {remaining} more exclusion{remaining === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}

export default ExclusionsSummary;
