/**
 * RiskFlagCard — the risk-flag summary shown above the fold on the policy
 * dashboard (R4.2, R4.5).
 *
 * When one or more risk flags are present it renders a visually distinct
 * (danger-toned) count such as "3 risk flags found" (R4.2). When the analysis
 * completed with no risk flags it renders a positive confirmation message
 * instead (R4.5).
 */

interface RiskFlagCardProps {
  /** Number of risk flags identified in the policy (High/Medium clauses). */
  count: number;
}

export function RiskFlagCard({ count }: RiskFlagCardProps) {
  // No risk flags → positive confirmation (R4.5).
  if (count <= 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-5 py-4"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-accent"
        >
          ✓
        </span>
        <div>
          <p className="font-display text-lg text-foreground">No risk flags found</p>
          <p className="text-sm text-muted">
            We didn&apos;t spot any high-impact clauses to worry about in this policy.
          </p>
        </div>
      </div>
    );
  }

  // One or more risk flags → visually distinct count (R4.2).
  const label = `${count} risk flag${count === 1 ? '' : 's'} found`;
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded-xl border border-danger/50 bg-danger/10 px-5 py-4"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/20 font-display text-2xl text-danger">
        {count}
      </span>
      <div>
        <p className="font-display text-lg text-danger">{label}</p>
        <p className="text-sm text-muted">
          Review the flagged clauses below to understand their impact.
        </p>
      </div>
    </div>
  );
}

export default RiskFlagCard;
