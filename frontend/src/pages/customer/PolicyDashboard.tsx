import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Policy, PolicyAnalysis } from '@policylens/shared';
import { api } from '../../lib/api';
import { HealthScoreGauge } from '../../components/HealthScoreGauge';
import { RiskFlagCard } from '../../components/RiskFlagCard';
import { ClauseCard } from '../../components/ClauseCard';
import { CoverageList } from '../../components/CoverageList';
import { ExclusionsSummary } from '../../components/ExclusionsSummary';
import { WaitingPeriodList } from '../../components/WaitingPeriodList';
import { RecommendationList } from '../../components/RecommendationList';

/**
 * Policy Dashboard (R4).
 *
 * Fetches the dashboard payload from `GET /api/policies/:id` and renders a
 * visual summary of the analysed policy:
 * - Header: provider name, premium amount, sum insured (R4.1).
 * - Above the fold: {@link RiskFlagCard} risk-flag count (R4.2, R4.5) and the
 *   {@link HealthScoreGauge} numeric score + quality band (R4.3).
 * - Coverage summary, exclusions summary, and waiting periods grouped by
 *   duration (R4.1).
 * - Flagged clauses in plain English (R4.1 risk flags).
 * - Up to 5 AI recommendations labelled gap vs risk, with a no-recommendations
 *   state (R4.4, R4.6).
 */

/** Dashboard payload returned by `GET /policies/:id` (design: API Design). */
interface PolicyDashboardPayload {
  policy: Policy;
  analysis: PolicyAnalysis | null;
}

/** Format a monetary amount in the policy's currency. */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to a plain number with the code.
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function PolicyDashboard() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery<PolicyDashboardPayload>({
    queryKey: ['policy', id],
    queryFn: () => api.get<PolicyDashboardPayload>(`/policies/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div
        role="status"
        className="mx-auto flex max-w-4xl items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
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
            className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:border-accent"
          >
            Back to vault
          </Link>
        </div>
      </div>
    );
  }

  const { policy, analysis } = data;

  // Analysis not yet available (policy still processing / failed).
  if (!analysis) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <h1 className="font-display text-xl text-foreground">{policy.title || policy.provider}</h1>
          <p className="mt-2 text-sm text-muted">
            This policy hasn&apos;t finished analysis yet. Check back once processing completes.
          </p>
        </div>
      </div>
    );
  }

  const healthScore = analysis.healthScore ?? 0;
  const riskFlagCount = analysis.riskFlagCount ?? analysis.hiddenClauses.length;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* Header: provider, premium, sum insured (R4.1) */}
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-foreground">
            {policy.title || `${policy.provider} policy`}
          </h1>
          <p className="text-sm text-muted">{policy.provider}</p>
          {analysis.partial && (
            <p className="text-xs text-amber-400">
              Partial analysis — some sections of this policy could not be fully analysed.
            </p>
          )}
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Premium</dt>
            <dd className="font-display text-lg text-foreground">
              {formatMoney(analysis.premium.amount, analysis.premium.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Sum insured</dt>
            <dd className="font-display text-lg text-foreground">
              {formatMoney(analysis.sumInsured, analysis.premium.currency)}
            </dd>
          </div>
        </dl>
      </header>

      {/* Quick links to related policy tools (R4.1) */}
      <nav aria-label="Policy tools" className="flex flex-wrap gap-3">
        <Link
          to={`/app/policy/${policy.id}/chat`}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground transition hover:border-accent hover:text-accent"
        >
          Ask about this policy
        </Link>
        <Link
          to="/app/compare"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground transition hover:border-accent hover:text-accent"
        >
          Compare policies
        </Link>
        <Link
          to="/app/claim-sim"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground transition hover:border-accent hover:text-accent"
        >
          Claim simulator
        </Link>
      </nav>

      {/* Above the fold: risk flags (R4.2/R4.5) + health score gauge (R4.3) */}
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col justify-center">
          <RiskFlagCard count={riskFlagCount} />
        </div>
        <HealthScoreGauge score={healthScore} />
      </div>

      {/* Coverage / exclusions / waiting periods (R4.1) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <DashboardPanel title="Coverage">
          <CoverageList coverage={analysis.coverage} />
        </DashboardPanel>
        <DashboardPanel title="Exclusions">
          <ExclusionsSummary exclusions={analysis.exclusions} />
        </DashboardPanel>
        <DashboardPanel title="Waiting periods">
          <WaitingPeriodList waitingPeriods={analysis.waitingPeriods} />
        </DashboardPanel>
      </div>

      {/* Flagged clauses in plain English (R4.1 risk flags) */}
      {analysis.hiddenClauses.length > 0 && (
        <DashboardPanel title="Flagged clauses">
          <div className="grid gap-3 sm:grid-cols-2">
            {analysis.hiddenClauses.map((clause, index) => (
              <ClauseCard key={`${clause.clause}-${index}`} clause={clause} />
            ))}
          </div>
        </DashboardPanel>
      )}

      {/* Up to 5 AI recommendations, gap vs risk (R4.4/R4.6) */}
      <DashboardPanel title="Recommendations">
        <RecommendationList recommendations={analysis.recommendations} />
      </DashboardPanel>
    </section>
  );
}

interface DashboardPanelProps {
  title: string;
  children: React.ReactNode;
}

/** A titled surface panel used to group dashboard sections. */
function DashboardPanel({ title, children }: DashboardPanelProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-sm uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default PolicyDashboard;
