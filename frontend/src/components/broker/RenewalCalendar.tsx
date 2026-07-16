import { Link } from 'react-router-dom';
import {
  formatMoneyCompact,
  humanizeKey,
  type RenewalCalendarEntry,
} from './types';

/**
 * Renewal calendar strip for the dashboard (R11.2/R11.3, surfaced per R9).
 *
 * Renders a compact, horizontally scrollable strip of upcoming renewals.
 * Entries due within 30 days carry a visually distinct "Due soon" indicator
 * (R11.3). Shows a friendly empty state when there are no upcoming renewals.
 */
interface RenewalCalendarProps {
  entries: RenewalCalendarEntry[];
  /** Currency used to render premium amounts (broker's configured currency). */
  currency: string;
  /** Optional cap on how many entries to show in the strip. */
  limit?: number;
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function RenewalCalendar({
  entries,
  currency,
  limit = 8,
}: RenewalCalendarProps) {
  const shown = entries.slice(0, limit);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Upcoming Renewals
        </h2>
        <Link
          to="/broker/renewals"
          className="text-xs font-medium text-[#2563EB] hover:underline"
        >
          View all
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          No renewals due in the next 90 days.
        </p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {shown.map((entry) => (
            <li
              key={entry.renewalId}
              className={[
                'flex min-w-[10rem] shrink-0 flex-col gap-1 rounded-lg border p-3',
                entry.dueSoon
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-slate-100 bg-slate-50',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {entry.clientName ?? 'Unknown client'}
                </span>
                {entry.dueSoon && (
                  <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Due soon
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500">
                {entry.policyType ? humanizeKey(entry.policyType) : 'Policy'}
                {entry.insurer ? ` · ${entry.insurer}` : ''}
              </span>
              <span className="text-xs text-slate-500">
                {formatDate(entry.renewalDate)}
                {typeof entry.daysUntil === 'number'
                  ? ` · ${entry.daysUntil}d`
                  : ''}
              </span>
              {typeof entry.premiumAmount === 'number' && (
                <span className="text-sm font-semibold text-slate-900">
                  {formatMoneyCompact(entry.premiumAmount, currency)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default RenewalCalendar;
