import { useQuery } from '@tanstack/react-query';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { api } from '../../lib/api';
import { PremiumChart } from '../../components/broker/PremiumChart';
import { BusinessMixDonut } from '../../components/broker/BusinessMixDonut';
import { CommissionBreakdown } from '../../components/broker/CommissionBreakdown';
import {
  formatMoney,
  humanizeKey,
  type BrokerAnalytics,
} from '../../components/broker/types';

/**
 * Broker Analytics page (route `/broker/analytics`, R19.7).
 *
 * Fetches the analytics payload from `GET /api/broker/analytics` and visualizes
 * a 12-month premium trend (reusing the dashboard {@link PremiumChart} and
 * {@link BusinessMixDonut} Recharts components), the portfolio policy mix, a
 * claims breakdown with approval rate, and the commission overview. Light,
 * card-based layout per R19.3.
 */

/** Status → slice colour for the claims donut. */
const CLAIM_STATUS_COLORS: Record<string, string> = {
  approved: '#10B981',
  pending: '#F59E0B',
  submitted: '#0EA5E9',
  under_review: '#8B5CF6',
  rejected: '#EF4444',
  denied: '#EF4444',
  unknown: '#94A3B8',
};

function claimColor(status: string, index: number): string {
  const palette = ['#2563EB', '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B', '#EF4444'];
  return CLAIM_STATUS_COLORS[status] ?? palette[index % palette.length] ?? '#94A3B8';
}

export function Analytics() {
  const analyticsQuery = useQuery<BrokerAnalytics>({
    queryKey: ['broker', 'analytics'],
    queryFn: () => api.get<BrokerAnalytics>('/broker/analytics'),
  });

  if (analyticsQuery.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
          aria-hidden
        />
        Loading your analytics…
      </div>
    );
  }

  if (analyticsQuery.error || !analyticsQuery.data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <h1 className="font-display text-lg text-slate-900">
          Couldn&apos;t load your analytics
        </h1>
        <p role="alert" className="mt-2 text-sm text-slate-500">
          Something went wrong. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void analyticsQuery.refetch()}
          className="mt-4 inline-block rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { currency, premiumTrend, policyMix, claims, commission } = analyticsQuery.data;

  const claimsData = Object.entries(claims.byStatus)
    .map(([status, count]) => ({ name: humanizeKey(status), status, value: count }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Analytics
        </h1>
        <p className="text-sm text-slate-500">
          Premium trends, policy mix, claims breakdown, and commission.
        </p>
      </header>

      {/* 12-month premium trend + business mix (reuse dashboard charts, R19.7). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PremiumChart collection={premiumTrend} currency={currency} />
        <BusinessMixDonut collection={premiumTrend} currency={currency} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Policy mix table (R19.7). */}
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Policy Mix
          </h2>
          {policyMix.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No policies to analyze yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 text-right font-medium">Policies</th>
                  <th className="pb-2 text-right font-medium">Premium</th>
                  <th className="pb-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {policyMix.map((slice) => (
                  <tr key={slice.type} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{humanizeKey(slice.type)}</td>
                    <td className="py-2 text-right font-medium text-slate-900">
                      {slice.count}
                    </td>
                    <td className="py-2 text-right text-slate-700">
                      {formatMoney(slice.premium, currency)}
                    </td>
                    <td className="py-2 text-right text-slate-500">
                      {slice.share.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Claims breakdown donut + approval rate (R19.7). */}
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Claims Breakdown
            </h2>
            <span className="text-xs text-slate-400">
              {claims.approvalRate.toFixed(2)}% approved
            </span>
          </div>
          {claimsData.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No claims to analyze yet.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-56 w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={claimsData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {claimsData.map((entry, index) => (
                        <Cell key={entry.status} fill={claimColor(entry.status, index)} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: '1px solid #E2E8F0',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex w-full flex-col gap-2 sm:w-1/2">
                {claimsData.map((entry, index) => (
                  <li key={entry.status} className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: claimColor(entry.status, index) }}
                    />
                    <span className="flex-1 text-slate-700">{entry.name}</span>
                    <span className="font-medium text-slate-900">{entry.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Commission overview (R19.7) — reuse the dashboard breakdown. */}
      <CommissionBreakdown commission={commission} />
    </div>
  );
}

export default Analytics;
