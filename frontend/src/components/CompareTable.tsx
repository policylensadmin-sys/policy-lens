import type { ComparisonResult } from '@policylens/shared';
import { qualityBand } from './HealthScoreGauge';

/**
 * CompareTable — renders a structured A/B policy comparison (R7.3, R7.4).
 *
 * Shows the two policies' numeric Health Scores (0–100), a per-attribute table
 * where each row highlights the superior policy with a visual indicator, and a
 * plain-English recommendation naming the overall winner.
 */

interface CompareTableProps {
  result: ComparisonResult;
  /** Display label for policy A (defaults to "Policy A"). */
  labelA?: string;
  /** Display label for policy B (defaults to "Policy B"). */
  labelB?: string;
}

/** Superiority indicator cell content for a comparison row. */
function superiorMark(isSuperior: boolean) {
  return isSuperior ? (
    <span className="font-medium text-accent" aria-label="superior">
      ▲ better
    </span>
  ) : null;
}

export function CompareTable({ result, labelA = 'Policy A', labelB = 'Policy B' }: CompareTableProps) {
  const bandA = qualityBand(result.scoreA);
  const bandB = qualityBand(result.scoreB);
  const winnerLabel =
    result.winner === 'A' ? labelA : result.winner === 'B' ? labelB : 'Both policies (tie)';

  return (
    <div className="flex flex-col gap-6">
      {/* Score header (R7.3) */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className={`rounded-xl border bg-surface p-5 text-center ${
            result.winner === 'A' ? 'border-accent' : 'border-border'
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-muted">{labelA}</p>
          <p className={`font-display text-3xl ${bandA.textClass}`}>{result.scoreA}</p>
          <p className="text-xs text-muted">{bandA.label} · Health Score</p>
        </div>
        <div
          className={`rounded-xl border bg-surface p-5 text-center ${
            result.winner === 'B' ? 'border-accent' : 'border-border'
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-muted">{labelB}</p>
          <p className={`font-display text-3xl ${bandB.textClass}`}>{result.scoreB}</p>
          <p className="text-xs text-muted">{bandB.label} · Health Score</p>
        </div>
      </div>

      {/* Per-attribute comparison with superior indicators (R7.4) */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background/40 text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3">
                Attribute
              </th>
              <th scope="col" className="px-4 py-3">
                {labelA}
              </th>
              <th scope="col" className="px-4 py-3">
                {labelB}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                  {row.label}
                </th>
                <td
                  className={`px-4 py-3 ${
                    row.superior === 'A' ? 'text-foreground' : 'text-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{row.valueA}</span>
                    {superiorMark(row.superior === 'A')}
                  </div>
                </td>
                <td
                  className={`px-4 py-3 ${
                    row.superior === 'B' ? 'text-foreground' : 'text-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{row.valueB}</span>
                    {superiorMark(row.superior === 'B')}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recommendation (R7.2/R7.3) */}
      <div className="rounded-xl border border-accent/40 bg-accent/10 p-5">
        <p className="text-xs uppercase tracking-wide text-accent">Recommendation</p>
        <p className="mt-1 font-display text-lg text-foreground">Winner: {winnerLabel}</p>
        <p className="mt-2 text-sm text-muted">{result.recommendation}</p>
      </div>
    </div>
  );
}

export default CompareTable;
