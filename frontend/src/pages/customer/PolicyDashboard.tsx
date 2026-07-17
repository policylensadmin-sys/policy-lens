import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Exclusion, Recommendation, WaitingPeriod } from '@policylens/shared';
import { api } from '../../lib/api';
import { HealthScoreGauge } from '../../components/HealthScoreGauge';
import { RiskFlagCard } from '../../components/RiskFlagCard';
import { ExclusionsSummary } from '../../components/ExclusionsSummary';
import { RecommendationList } from '../../components/RecommendationList';

/**
 * Policy Dashboard (R4).
 *
 * Consumes the flat dashboard payload returned by `GET /api/policies/:id`
 * (see backend PolicyService.getDashboard): policy headline fields plus derived
 * view-model fields (healthScore, coverageSummary, exclusionSummary,
 * waitingPeriodsByDuration, recommendations, riskFlagCount).
 */

/** Matches the backend PolicyService.getDashboard payload. */
interface DashboardPayload {
  policy: {
    id: string;
    category: string;
    title: string;
    provider: string | null;
    premiumAmount: number | null;
    premiumCurrency: string | null;
    sumInsured: number | null;
    originalFilename: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  analyzed: boolean;
  healthScore: number | null;
  qualityBand: string | null;
  coverageSummary: string[];
  exclusionSummary: { count: number; top: Exclusion[] };
  riskFlagCount: number;
  waitingPeriodsByDuration: Record<string, WaitingPeriod[]>;
  recommendations: Recommendation[];
  noRiskFlags: boolean;
  noRecommendations: boolean;
  partial: boolean;
  notFound: string[];
}

/** Format a monetary amount, tolerating null/unknown currency. */
function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const cur = currency || 'INR';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${cur} ${amount.toLocaleString()}`;
  }
}

export function PolicyDashboard() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery<DashboardPayload>({
    queryKey: ['policy', id],
    queryFn: () => api.get<DashboardPayload>(`/policies/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div
        role="status"
        className="mx-auto flex max-w-4xl items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
          aria-hidden
        />
        Loading your policy dashboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-6 text-center">
          <h1 className="font-display text-lg text-foreground">Couldn&apos;t load this policy</h1>
          <p role="alert" className="mt-2 text-sm text-muted">
            We couldn&apos;t load the analysis for this policy. It may still be processing.
          </p>
          <Link
            to="/app/vault"
            className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary"
          >
            Back to vault
          </Link>
        </div>
      </div>
    );
  }

  const { policy } = data;

  // Analysis not yet available (still processing / failed).
  if (!data.analyzed) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <h1 className="font-display text-xl text-foreground">
            {policy.title || policy.provider || 'Policy'}
          </h1>
          <p className="mt-2 text-sm text-muted">
            This policy hasn&apos;t finished analysis yet. Check back once processing completes.
          </p>
          <Link
            to="/app/vault"
            className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary"
          >
            Back to vault
          </Link>
        </div>
      </div>
    );
  }

  const healthScore = data.healthScore ?? 0;
  const coverage = data.coverageSummary ?? [];
  const exclusions = data.exclusionSummary?.top ?? [];
  const waitingGroups = Object.entries(data.waitingPeriodsByDuration ?? {});
  const recommendations = data.recommendations ?? [];

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* Header: provider, premium, sum insured (R4.1) */}
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-foreground">
            {policy.title || `${policy.provider ?? 'Policy'}`}
          </h1>
          {policy.provider && <p className="text-sm text-muted">{policy.provider}</p>}
          {data.partial && (
            <p className="text-xs text-amber-400">
              Partial analysis — some sections of this policy could not be fully analysed.
            </p>
          )}
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Premium</dt>
            <dd className="font-display text-lg text-foreground">
              {formatMoney(policy.premiumAmount, policy.premiumCurrency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Sum insured</dt>
            <dd className="font-display text-lg text-foreground">
              {formatMoney(policy.sumInsured, policy.premiumCurrency)}
            </dd>
          </div>
        </dl>
      </header>

      {/* Quick links to related policy tools */}
      <nav aria-label="Policy tools" className="flex flex-wrap gap-3">
        <Link
          to={`/app/policy/${policy.id}/chat`}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground transition hover:border-primary hover:text-primary"
        >
          Ask about this policy
        </Link>
        <Link
          to="/app/compare"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground transition hover:border-primary hover:text-primary"
        >
          Compare policies
        </Link>
        <Link
          to="/app/claim-sim"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground transition hover:border-primary hover:text-primary"
        >
          Claim simulator
        </Link>
      </nav>

      {/* Above the fold: risk flags (R4.2/R4.5) + health score gauge (R4.3) */}
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col justify-center">
          <RiskFlagCard count={data.riskFlagCount ?? 0} />
        </div>
        <HealthScoreGauge score={healthScore} />
      </div>

      {/* Coverage / exclusions / waiting periods (R4.1) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <DashboardPanel title="Coverage">
          {coverage.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {coverage.map((type) => (
                <li
                  key={type}
                  className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  {type}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No covered categories were identified.</p>
          )}
        </DashboardPanel>

        <DashboardPanel title="Exclusions">
          <ExclusionsSummary exclusions={exclusions} />
        </DashboardPanel>

        <DashboardPanel title="Waiting periods">
          {waitingGroups.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {waitingGroups.map(([duration, periods]) => (
                <li key={duration}>
                  <p className="text-sm font-medium text-foreground">{duration}</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {periods.map((wp, i) => (
                      <li key={`${wp.appliesTo}-${i}`} className="text-xs text-muted">
                        {wp.appliesTo}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No waiting periods were identified.</p>
          )}
        </DashboardPanel>
      </div>

      {/* Up to 5 AI recommendations, gap vs risk (R4.4/R4.6) */}
      <DashboardPanel title="Recommendations">
        <RecommendationList recommendations={recommendations} />
      </DashboardPanel>
    </section>
  );
}

interface DashboardPanelProps {
  title: string;
  children: React.ReactNode;
}

function DashboardPanel({ title, children }: DashboardPanelProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-sm uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default PolicyDashboard;
