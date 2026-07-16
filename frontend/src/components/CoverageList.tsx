import type { Coverage } from '@policylens/shared';

/**
 * CoverageList — the coverage summary listing covered category types (R4.1).
 *
 * Renders each coverage line as a chip; covered items are accented while
 * not-covered items are muted with a strike indicator so the reader can scan
 * what the policy does and doesn't include.
 */

interface CoverageListProps {
  coverage: Coverage[];
  /** Message shown when the analysis found no coverage items (R3.9). */
  emptyMessage?: string;
}

export function CoverageList({
  coverage,
  emptyMessage = 'No coverage details were identified in this policy.',
}: CoverageListProps) {
  if (coverage.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {coverage.map((item, index) => (
        <li
          key={`${item.type}-${index}`}
          className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2"
        >
          <span
            aria-hidden
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
              item.covered ? 'bg-accent/20 text-accent' : 'bg-border text-muted'
            }`}
          >
            {item.covered ? '✓' : '—'}
          </span>
          <div>
            <p
              className={`text-sm font-medium ${
                item.covered ? 'text-foreground' : 'text-muted line-through'
              }`}
            >
              {item.type}
            </p>
            {item.detail && <p className="text-xs text-muted">{item.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default CoverageList;
