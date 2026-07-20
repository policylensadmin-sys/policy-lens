import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INSIGHT_TYPES } from '@policylens/shared';
import { api } from '../../lib/api';
import { Bot } from 'lucide-react';
import { AIInsightList } from '../../components/broker/AIInsightList';
import { AskLens } from '../../components/broker/AskLens';
import {
  formatTimestamp,
  humanizeKey,
  insightAttribute,
  type DashboardInsight,
  type InsightsResult,
  type InsightView,
} from '../../components/broker/types';

/**
 * Broker AI Assistant page (R13.3, R13.4, R13.5).
 *
 * Fetches the broker's categorized AI insights from `GET /api/broker/insights`
 * and presents them grouped by category (upselling / risk alerts / renewal
 * optimization / coverage improvement, R13.3). Each recommendation shows the
 * affected client(s), the relevant policy or coverage attribute, and the
 * explanation of why it was generated (R13.4) — rendered via the shared
 * {@link AIInsightList}. Category filter chips let the broker focus on one
 * type. When insights can't be generated (insufficient data or the service is
 * unavailable), a notice is shown with the timestamp of the last successfully
 * generated insights (R13.5).
 */

const REFETCH_INTERVAL_MS = 60_000;

/** Friendly labels for each insight category (R13.3). */
const CATEGORY_LABELS: Record<string, string> = {
  upsell: 'Upselling',
  risk_alert: 'Risk Alerts',
  renewal_opt: 'Renewal Optimization',
  coverage_improvement: 'Coverage Improvement',
};

export function AIAssistant() {
  const [category, setCategory] = useState<string>('all');

  const insightsQuery = useQuery<InsightsResult>({
    queryKey: ['broker', 'insights'],
    queryFn: () => api.get<InsightsResult>('/broker/insights'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const data = insightsQuery.data;
  const insights = data?.insights ?? [];

  const filtered = useMemo(
    () =>
      category === 'all'
        ? insights
        : insights.filter((insight) => insight.type === category),
    [insights, category],
  );

  /** Counts per category for the filter chips. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const insight of insights) {
      map.set(insight.type, (map.get(insight.type) ?? 0) + 1);
    }
    return map;
  }, [insights]);

  const listInsights: DashboardInsight[] = filtered.map(toDashboardInsight);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">AI Assistant</h1>
        <p className="text-sm text-slate-500">
          AI-generated recommendations across your client portfolio.
        </p>
      </header>

      {/* Interactive "Ask Lens" chat — grounded in the broker's portfolio. */}
      <AskLens />

      {insightsQuery.isLoading ? (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-sm"
        >
          Analyzing your portfolio…
        </div>
      ) : insightsQuery.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <p role="alert" className="text-sm text-rose-600">
            Couldn&apos;t load insights. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void insightsQuery.refetch()}
            className="mt-3 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : data && !data.available ? (
        // Unavailable fallback with last-generated timestamp (R13.5).
        <section className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <Bot className="text-amber-500" size={28} strokeWidth={1.75} aria-hidden />

          <h2 className="font-display text-base font-semibold text-slate-900">
            Insights are temporarily unavailable
          </h2>
          <p className="max-w-md text-sm text-slate-600">
            {data.message ??
              'We couldn\u2019t generate insights right now. Please try again later.'}
          </p>
          <p className="text-xs text-slate-500">
            {formatTimestamp(data.lastGeneratedAt)
              ? `Last generated ${formatTimestamp(data.lastGeneratedAt)}`
              : 'No insights have been generated yet.'}
          </p>
          <button
            type="button"
            onClick={() => void insightsQuery.refetch()}
            className="mt-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            Refresh
          </button>
        </section>
      ) : (
        <>
          {/* Category filter chips (R13.3). */}
          <div className="flex flex-wrap gap-2">
            <CategoryChip
              label="All"
              count={insights.length}
              active={category === 'all'}
              onClick={() => setCategory('all')}
            />
            {INSIGHT_TYPES.map((type) => (
              <CategoryChip
                key={type}
                label={CATEGORY_LABELS[type] ?? humanizeKey(type)}
                count={counts.get(type) ?? 0}
                active={category === type}
                onClick={() => setCategory(type)}
              />
            ))}
          </div>

          {data?.generatedAt && (
            <p className="text-xs text-slate-400">
              Last updated {formatTimestamp(data.generatedAt)}
            </p>
          )}

          {/* Categorized insights: affected clients + attribute + explanation
              (R13.4), rendered via the shared AIInsightList. */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
              No {category === 'all' ? '' : `${CATEGORY_LABELS[category] ?? ''} `}insights
              to show.
            </div>
          ) : (
            <>
              {/* Relevant-attribute callouts surfaced alongside the list (R13.4). */}
              <AttributeSummary insights={filtered} />
              <AIInsightList insights={listInsights} limit={listInsights.length} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** A single category filter chip with a count badge. */
function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          active ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Surfaces the relevant coverage/policy attribute for each insight that carries
 * one in its evidence (R13.4), complementing the explanation shown in the list.
 */
function AttributeSummary({ insights }: { insights: InsightView[] }) {
  const withAttribute = insights
    .map((insight) => ({ insight, attribute: insightAttribute(insight.evidence) }))
    .filter((entry): entry is { insight: InsightView; attribute: string } =>
      Boolean(entry.attribute),
    );

  if (withAttribute.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-display text-sm font-semibold text-slate-900">
        Relevant attributes
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {withAttribute.map(({ insight, attribute }, index) => (
          <li
            key={insight.id ?? `${insight.type}-${index}`}
            className="rounded-md border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
          >
            <span className="font-medium text-slate-800">{attribute}</span>
            <span className="text-slate-400"> · {insight.clientIds.length} client(s)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Adapt an InsightView to the DashboardInsight shape AIInsightList expects. */
function toDashboardInsight(insight: InsightView, index: number): DashboardInsight {
  return {
    id: insight.id ?? `${insight.type}-${index}`,
    type: insight.type,
    message: insight.message,
    clientIds: insight.clientIds,
    generatedAt: insight.generatedAt,
  };
}

export default AIAssistant;
