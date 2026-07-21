import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { CommissionBreakdown } from '../../components/broker/CommissionBreakdown';
import {
  formatMoney,
  formatMoneyCompact,
  humanizeKey,
  type BrokerReports,
} from '../../components/broker/types';

/**
 * Broker Reports page (route `/broker/reports`, R19.7).
 *
 * Fetches the aggregated reports payload from `GET /api/broker/reports` and
 * presents four report cards covering policy volume, premium revenue, claims
 * activity, and commission earned. Card-based light layout per R19.3; empty
 * portfolios render friendly zero-states.
 */
export function Reports() {
  const reportsQuery = useQuery<BrokerReports>({
    queryKey: ['broker', 'reports'],
    queryFn: () => api.get<BrokerReports>('/broker/reports'),
  });

  if (reportsQuery.isLoading) {
    return <LoadingCard label="Loading your reports…" />;
  }

  if (reportsQuery.error || !reportsQuery.data) {
    return (
      <ErrorCard
        title="Couldn't load your reports"
        onRetry={() => void reportsQuery.refetch()}
      />
    );
  }

  const { currency, policyVolume, premiumRevenue, claimsActivity, commission } =
    reportsQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Reports
        </h1>
        <p className="text-sm text-slate-500">
          Policy volume, premium revenue, claims activity, and commission earned.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Policy volume (R19.7). */}
        <ReportCard title="Policy Volume" headline={`${policyVolume.total}`} headlineHint="total policies">
          {policyVolume.total === 0 ? (
            <EmptyRow message="No policies recorded yet." />
          ) : (
            <div className="flex flex-col gap-4">
              <BreakdownList
                heading="By type"
                rows={toCountRows(policyVolume.byType)}
                formatValue={(v) => `${v}`}
              />
              <BreakdownList
                heading="By status"
                rows={toCountRows(policyVolume.byStatus)}
                formatValue={(v) => `${v}`}
              />
            </div>
          )}
        </ReportCard>

        {/* Premium revenue (R19.7). */}
        <ReportCard
          title="Premium Revenue"
          headline={formatMoneyCompact(premiumRevenue.total, currency)}
          headlineHint="total premium"
        >
          {premiumRevenue.total === 0 ? (
            <EmptyRow message="No premium revenue recorded yet." />
          ) : (
            <BreakdownList
              heading="By type"
              rows={toCountRows(premiumRevenue.byType)}
              formatValue={(v) => formatMoney(v, currency)}
            />
          )}
        </ReportCard>

        {/* Claims activity (R19.7). */}
        <ReportCard title="Claims Activity" headline={`${claimsActivity.total}`} headlineHint="total claims">
          {claimsActivity.total === 0 ? (
            <EmptyRow message="No claims recorded yet." />
          ) : (
            <div className="flex flex-col gap-4">
              <BreakdownList
                heading="By status"
                rows={toCountRows(claimsActivity.byStatus)}
                formatValue={(v) => `${v}`}
              />
              <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">Total claimed amount</span>
                <span className="font-semibold text-slate-900">
                  {formatMoney(claimsActivity.totalClaimedAmount, currency)}
                </span>
              </div>
            </div>
          )}
        </ReportCard>

        {/* Commission earned (R19.7) — reuse the dashboard breakdown. */}
        <CommissionBreakdown commission={commission} />
      </div>
    </div>
  );
}

/** A titled report card with an optional headline number and body content. */
function ReportCard({
  title,
  headline,
  headlineHint,
  children,
}: {
  title: string;
  headline?: string;
  headlineHint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-sm font-semibold text-slate-900">{title}</h2>
        {headline !== undefined && (
          <span className="flex items-baseline gap-1">
            <span className="font-display text-xl font-semibold text-slate-900">
              {headline}
            </span>
            {headlineHint && <span className="text-xs text-slate-400">{headlineHint}</span>}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A labelled list of key → value rows with a small bar for relative weight. */
function BreakdownList({
  heading,
  rows,
  formatValue,
}: {
  heading: string;
  rows: Array<{ key: string; value: number }>;
  formatValue: (value: number) => string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
        {heading}
      </span>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-700">{humanizeKey(row.key)}</span>
              <span className="font-medium text-slate-900">{formatValue(row.value)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#2563EB]"
                style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <p className="py-4 text-center text-sm text-slate-400">{message}</p>;
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm"
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
        aria-hidden
      />
      {label}
    </div>
  );
}

function ErrorCard({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
      <h1 className="font-display text-lg text-slate-900">{title}</h1>
      <p role="alert" className="mt-2 text-sm text-slate-500">
        Something went wrong. Please try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-block rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
      >
        Retry
      </button>
    </div>
  );
}

/** Convert a `Record<string, number>` into sorted `{ key, value }` rows. */
function toCountRows(record: Record<string, number>): Array<{ key: string; value: number }> {
  return Object.entries(record)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export default Reports;
