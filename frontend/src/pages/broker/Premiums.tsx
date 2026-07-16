import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PremiumChart } from '../../components/broker/PremiumChart';
import {
  DEFAULT_BROKER_CURRENCY,
  formatMoney,
  type CollectionBucket,
  type PremiumCollection,
  type PremiumTracker,
} from '../../components/broker/types';

/**
 * Broker Premium Tracker page (route `/broker/premiums`, R11.4).
 *
 * Fetches the premium tracker from `GET /api/broker/premiums`: collection
 * status buckets (Paid / Pending / Overdue) with counts and summed premium,
 * plus a trailing-12-month chart broken down by insurance type. The chart is
 * rendered by reusing the {@link PremiumChart} (Recharts) component, which
 * carries its own empty-state.
 */

/** Auto-refresh interval — keeps figures fresh within 60s (R9.4). */
const REFETCH_INTERVAL_MS = 60_000;

interface CollectionCard {
  key: 'paid' | 'pending' | 'overdue';
  label: string;
  bucket: CollectionBucket;
  tone: string;
}

export function Premiums() {
  const premiumsQuery = useQuery<PremiumTracker>({
    queryKey: ['broker', 'premiums'],
    queryFn: () => api.get<PremiumTracker>('/broker/premiums'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  if (premiumsQuery.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
          aria-hidden
        />
        Loading premium tracker…
      </div>
    );
  }

  if (premiumsQuery.error || !premiumsQuery.data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <h1 className="font-display text-lg text-slate-900">
          Couldn&apos;t load premium tracker
        </h1>
        <p role="alert" className="mt-2 text-sm text-slate-500">
          Something went wrong loading premium collection. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void premiumsQuery.refetch()}
          className="mt-4 inline-block rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const tracker = premiumsQuery.data;
  const currency = DEFAULT_BROKER_CURRENCY;

  // The PremiumChart consumes a PremiumCollection; the tracker already carries
  // the monthly series, insurance types, and empty flag it needs.
  const collection: PremiumCollection = {
    months: tracker.months,
    types: tracker.types,
    empty: tracker.empty,
  };

  const cards: CollectionCard[] = [
    { key: 'paid', label: 'Paid', bucket: tracker.collection.paid, tone: 'text-emerald-600' },
    { key: 'pending', label: 'Pending', bucket: tracker.collection.pending, tone: 'text-amber-600' },
    { key: 'overdue', label: 'Overdue', bucket: tracker.collection.overdue, tone: 'text-rose-600' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Premium Tracker
        </h1>
        <p className="text-sm text-slate-500">
          Collection status and monthly premium over the last 12 months.
        </p>
      </header>

      {/* Collection status buckets (R11.4). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.key}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {card.label}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {card.bucket.count}{' '}
                {card.bucket.count === 1 ? 'policy' : 'policies'}
              </span>
            </div>
            <span className={`font-display text-2xl font-semibold ${card.tone}`}>
              {formatMoney(card.bucket.amount, currency)}
            </span>
          </div>
        ))}
      </div>

      {/* 12-month premium chart by insurance type (R11.4). */}
      <PremiumChart collection={collection} currency={currency} />
    </div>
  );
}

export default Premiums;
