import { useEffect, useState } from 'react';
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
 *
 * Each entry is an interactive button: activating it (click, Enter or Space)
 * opens a small detail popover showing the renewal's client, policy, date and
 * premium, with a shortcut through to the policies view.
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
  const [selected, setSelected] = useState<RenewalCalendarEntry | null>(null);

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
            <li key={entry.renewalId} className="flex">
              <button
                type="button"
                onClick={() => setSelected(entry)}
                aria-haspopup="dialog"
                aria-label={`View renewal for ${
                  entry.clientName ?? 'Unknown client'
                }`}
                className={[
                  'flex min-w-[10rem] shrink-0 flex-col gap-1 rounded-lg border p-3 text-left transition',
                  'hover:border-[#2563EB] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-1',
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
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <RenewalDetail
          entry={selected}
          currency={currency}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

/** A lightweight, keyboard-dismissable detail popover for a single renewal. */
function RenewalDetail({
  entry,
  currency,
  onClose,
}: {
  entry: RenewalCalendarEntry;
  currency: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Renewal details"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              {entry.clientName ?? 'Unknown client'}
            </h3>
            <p className="text-xs text-slate-500">
              {entry.policyType ? humanizeKey(entry.policyType) : 'Policy'}
              {entry.insurer ? ` · ${entry.insurer}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ×
          </button>
        </div>

        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Renewal date</dt>
            <dd className="font-medium text-slate-900">
              {formatDate(entry.renewalDate)}
              {typeof entry.daysUntil === 'number'
                ? ` · ${entry.daysUntil}d`
                : ''}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Premium</dt>
            <dd className="font-semibold text-slate-900">
              {typeof entry.premiumAmount === 'number'
                ? formatMoneyCompact(entry.premiumAmount, currency)
                : '—'}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium text-slate-900">
              {entry.dueSoon ? 'Due soon' : 'Upcoming'}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex justify-end">
          <Link
            to="/broker/policies"
            onClick={onClose}
            className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            View policies
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RenewalCalendar;
