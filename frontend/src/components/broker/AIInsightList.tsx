import { Link } from 'react-router-dom';
import { humanizeKey, type DashboardInsight } from './types';

/**
 * AI Insights list for the dashboard (R13.3, R13.4).
 *
 * Each insight is shown with its category (type), the count of affected
 * client(s), and the textual explanation of why it was generated. Categories
 * are colour-coded (upselling / risk alert / renewal optimization / coverage
 * improvement, R13.3). When no insights are available, shows an unavailable
 * state with the timestamp of the last successfully generated insight (R13.5).
 */
interface AIInsightListProps {
  insights: DashboardInsight[];
  /** Optional cap on how many insights to show. */
  limit?: number;
}

/** Category → badge style. Unknown categories fall back to a neutral badge. */
const CATEGORY_STYLES: Record<string, string> = {
  upsell: 'bg-emerald-100 text-emerald-700',
  upselling: 'bg-emerald-100 text-emerald-700',
  risk: 'bg-rose-100 text-rose-700',
  risk_alert: 'bg-rose-100 text-rose-700',
  renewal: 'bg-sky-100 text-sky-700',
  renewal_optimization: 'bg-sky-100 text-sky-700',
  coverage: 'bg-violet-100 text-violet-700',
  coverage_improvement: 'bg-violet-100 text-violet-700',
};

function badgeClass(type: string): string {
  return CATEGORY_STYLES[type] ?? 'bg-slate-100 text-slate-600';
}

function formatTimestamp(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AIInsightList({ insights, limit = 5 }: AIInsightListProps) {
  const shown = insights.slice(0, limit);
  const lastGeneratedAt = insights.reduce<string | null>((latest, insight) => {
    if (!insight.generatedAt) {
      return latest;
    }
    if (!latest || insight.generatedAt > latest) {
      return insight.generatedAt;
    }
    return latest;
  }, null);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          AI Insights
        </h2>
        <Link
          to="/broker/ai-assistant"
          className="text-xs font-medium text-[#2563EB] hover:underline"
        >
          View all
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col gap-1 py-4 text-center">
          <p className="text-sm font-medium text-slate-600">
            Insights are temporarily unavailable
          </p>
          <p className="text-xs text-slate-400">
            {formatTimestamp(lastGeneratedAt)
              ? `Last generated ${formatTimestamp(lastGeneratedAt)}`
              : 'No insights have been generated yet. Add clients and policies to unlock recommendations.'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((insight) => (
            <li
              key={insight.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badgeClass(
                    insight.type,
                  )}`}
                >
                  {humanizeKey(insight.type)}
                </span>
                <span className="text-xs text-slate-500">
                  {insight.clientIds.length} affected client
                  {insight.clientIds.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-sm text-slate-700">{insight.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default AIInsightList;
