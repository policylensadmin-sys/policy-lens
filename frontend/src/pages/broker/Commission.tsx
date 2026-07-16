import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { CommissionBreakdown } from '../../components/broker/CommissionBreakdown';
import { formatMoney, type CommissionOverview } from '../../components/broker/types';

/**
 * Broker Commission page (route `/broker/commission`, R9.3).
 *
 * Fetches the commission overview from `GET /api/broker/commission`: total,
 * paid, pending, and overdue amounts, each rendered to 2 decimal places in the
 * broker's configured currency. Reuses the {@link CommissionBreakdown}
 * component for the headline breakdown and adds a short definition of how each
 * bucket is derived.
 */

/** Auto-refresh interval — keeps figures fresh within 60s (R9.4). */
const REFETCH_INTERVAL_MS = 60_000;

/** Response envelope from `GET /api/broker/commission`. */
interface CommissionResponse {
  commission: CommissionOverview;
}

export function Commission() {
  const commissionQuery = useQuery<CommissionResponse>({
    queryKey: ['broker', 'commission'],
    queryFn: () => api.get<CommissionResponse>('/broker/commission'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  if (commissionQuery.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
          aria-hidden
        />
        Loading commission overview…
      </div>
    );
  }

  if (commissionQuery.error || !commissionQuery.data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <h1 className="font-display text-lg text-slate-900">
          Couldn&apos;t load commission overview
        </h1>
        <p role="alert" className="mt-2 text-sm text-slate-500">
          Something went wrong loading your commission figures. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void commissionQuery.refetch()}
          className="mt-4 inline-block rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { commission } = commissionQuery.data;
  const outstanding = commission.pending + commission.overdue;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Commission
        </h1>
        <p className="text-sm text-slate-500">
          Your commission earned, paid, and outstanding.
        </p>
      </header>

      {/* Total / paid / pending / overdue breakdown (R9.3). */}
      <CommissionBreakdown commission={commission} />

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Outstanding commission
        </h2>
        <span className="font-display text-2xl font-semibold text-slate-900">
          {formatMoney(outstanding, commission.currency)}
        </span>
        <p className="text-xs text-slate-500">
          Pending plus overdue commission still to be collected. Overdue is
          unpaid commission more than 30 days past its scheduled payment date.
        </p>
      </section>
    </div>
  );
}

export default Commission;
