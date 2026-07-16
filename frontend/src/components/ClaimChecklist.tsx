import type { ClaimResult, ClaimCheckStatus } from '@policylens/shared';

/**
 * ClaimChecklist — renders a claim simulation result (R8.3, R8.4).
 *
 * Shows the approval probability (0–100%), a checklist of evaluated items with
 * satisfied / warning / failed indicators, the supporting reasons (each
 * referencing a policy term), and — when the scenario matches an exclusion —
 * the named exclusion that blocks the claim (R8.4/R8.5).
 */

interface ClaimChecklistProps {
  result: ClaimResult;
}

/** Visual treatment for each check status. */
const STATUS_META: Record<ClaimCheckStatus, { icon: string; classes: string; label: string }> = {
  ok: { icon: '✓', classes: 'bg-accent/20 text-accent', label: 'Satisfied' },
  warn: { icon: '!', classes: 'bg-amber-400/20 text-amber-400', label: 'Caution' },
  fail: { icon: '✕', classes: 'bg-danger/20 text-danger', label: 'Not satisfied' },
};

/** Colour the probability by likelihood band. */
function probabilityClass(probability: number): string {
  if (probability >= 70) return 'text-accent';
  if (probability >= 40) return 'text-amber-400';
  return 'text-danger';
}

export function ClaimChecklist({ result }: ClaimChecklistProps) {
  const probability = Math.min(Math.max(Math.round(result.approvalProbability), 0), 100);

  return (
    <div className="flex flex-col gap-6">
      {/* Approval probability (R8.3) */}
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-xs uppercase tracking-wide text-muted">Approval probability</p>
        <p className={`font-display text-5xl ${probabilityClass(probability)}`}>{probability}%</p>
        <div
          className="mx-auto mt-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-background"
          role="progressbar"
          aria-valuenow={probability}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${probability}%` }}
          />
        </div>
      </div>

      {/* Matched exclusion, if any (R8.4/R8.5) */}
      {result.matchedExclusion && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-5">
          <p className="text-xs uppercase tracking-wide text-danger">Exclusion applies</p>
          <p className="mt-1 text-sm text-foreground">{result.matchedExclusion}</p>
        </div>
      )}

      {/* Per-item checklist (R8.4) */}
      {result.checks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-display text-sm uppercase tracking-wide text-muted">Checks</h3>
          <ul className="flex flex-col gap-2">
            {result.checks.map((check, index) => {
              const meta = STATUS_META[check.status];
              return (
                <li
                  key={`${check.label}-${index}`}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3"
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${meta.classes}`}
                  >
                    {meta.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{check.label}</p>
                    <p className="text-xs text-muted">
                      <span className="sr-only">{meta.label}: </span>
                      {check.detail ?? meta.label}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Supporting reasons, each referencing a policy term (R8.3) */}
      {result.reasons.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-display text-sm uppercase tracking-wide text-muted">Reasons</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            {result.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default ClaimChecklist;
