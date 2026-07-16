import { Link } from 'react-router-dom';
import type { PolicyCategory, PolicyStatus } from '@policylens/shared';
import { qualityBand } from './HealthScoreGauge';

/**
 * A vault list entry as returned by `GET /api/policies` (mirrors the backend
 * `VaultPolicy` view-model: a policy plus its headline analysis fields) (R6).
 */
export interface VaultPolicy {
  id: string;
  category: PolicyCategory;
  title: string;
  provider: string | null;
  premiumAmount: number | null;
  premiumCurrency: string | null;
  sumInsured: number | null;
  familyMemberId: string | null;
  originalFilename: string | null;
  status: PolicyStatus;
  /** Health Score when analysis has completed, else `null`. */
  healthScore: number | null;
  riskFlagCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Human-friendly label for each policy category (R6.2). */
const CATEGORY_LABELS: Record<PolicyCategory, string> = {
  health: 'Health',
  life: 'Life',
  motor: 'Motor',
  travel: 'Travel',
  home: 'Home',
};

interface PolicyCardProps {
  policy: VaultPolicy;
  /** Optional display name for the assigned family member (R6.6). */
  familyMemberName?: string | null;
  /** Trigger a download of the original document (R6.4). */
  onDownload: (policy: VaultPolicy) => void;
  /** True while a download URL for this card is being prepared. */
  downloading?: boolean;
  /** Request deletion (opens a confirmation dialog) (R6.5). */
  onDelete: (policy: VaultPolicy) => void;
}

/**
 * PolicyCard — a single policy tile in the vault grid (R6).
 *
 * Shows the policy title, provider, category badge, Health Score (coloured by
 * quality band), and — when assigned — the family member. Provides quick
 * actions to open the dashboard, download the original document, and delete
 * the policy.
 */
export function PolicyCard({
  policy,
  familyMemberName,
  onDownload,
  downloading = false,
  onDelete,
}: PolicyCardProps) {
  const hasScore = typeof policy.healthScore === 'number';
  const band = hasScore ? qualityBand(policy.healthScore as number) : null;

  return (
    <article className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <span className="inline-block rounded-full border border-border bg-background/40 px-2.5 py-0.5 text-xs uppercase tracking-wide text-muted">
            {CATEGORY_LABELS[policy.category] ?? policy.category}
          </span>
          <h3 className="truncate font-display text-lg text-foreground">
            {policy.title || policy.provider || 'Untitled policy'}
          </h3>
          {policy.provider && <p className="truncate text-sm text-muted">{policy.provider}</p>}
          {familyMemberName && (
            <p className="text-xs text-muted">
              Family member: <span className="text-foreground">{familyMemberName}</span>
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {hasScore && band ? (
            <>
              <p className={`font-display text-2xl ${band.textClass}`}>{policy.healthScore}</p>
              <p className="text-[0.65rem] uppercase tracking-wide text-muted">{band.label}</p>
            </>
          ) : (
            <p className="text-xs text-muted">
              {policy.status === 'failed' ? 'Analysis failed' : 'Analyzing…'}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/app/policy/${policy.id}`}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-accent hover:text-accent"
        >
          View
        </Link>
        <button
          type="button"
          onClick={() => onDownload(policy)}
          disabled={downloading}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloading ? 'Preparing…' : 'Download'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(policy)}
          className="rounded-md border border-danger/40 px-3 py-1.5 text-xs text-danger transition hover:bg-danger/10"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export default PolicyCard;
