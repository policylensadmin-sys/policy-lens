import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { RenewalCalendar } from '../../components/broker/RenewalCalendar';
import {
  DEFAULT_BROKER_CURRENCY,
  type RenewalCalendar as RenewalCalendarPayload,
  type ReminderSummary,
} from '../../components/broker/types';

/**
 * Broker Renewals page (route `/broker/renewals`, R11.2/R11.3/R11.5/R11.7).
 *
 * Fetches the renewal calendar from `GET /api/broker/renewals` — renewals due
 * within the next 90 days, each entry flagged `dueSoon` when it falls within
 * 30 days so the calendar can render a visually distinct indicator (R11.2/
 * R11.3). Reuses the {@link RenewalCalendar} component for the calendar strip.
 *
 * A "Send reminders" control posts to `POST /api/broker/renewals/remind` for a
 * broker-selected window and surfaces a confirmation summary: the count of
 * reminders sent (R11.5) plus any failed recipients, which the broker can retry
 * (R11.7).
 */

/** Auto-refresh interval — keeps the calendar fresh within 60s (R9.4). */
const REFETCH_INTERVAL_MS = 60_000;

/** Reminder window options the broker can choose from (bounded by the 90d horizon). */
const REMINDER_WINDOWS = [
  { label: 'Due within 30 days', value: 30 },
  { label: 'Due within 60 days', value: 60 },
  { label: 'Due within 90 days', value: 90 },
] as const;

export function Renewals() {
  const queryClient = useQueryClient();
  const [withinDays, setWithinDays] = useState<number>(30);

  const renewalsQuery = useQuery<RenewalCalendarPayload>({
    queryKey: ['broker', 'renewals'],
    queryFn: () => api.get<RenewalCalendarPayload>('/broker/renewals'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const remindMutation = useMutation<ReminderSummary, unknown, number>({
    mutationFn: (days: number) =>
      api.post<ReminderSummary>('/broker/renewals/remind', { withinDays: days }),
    onSuccess: () => {
      // Reminder delivery marks renewals as reminded; refresh the calendar.
      void queryClient.invalidateQueries({ queryKey: ['broker', 'renewals'] });
    },
  });

  const entries = renewalsQuery.data?.entries ?? [];
  const dueSoonCount = useMemo(
    () => entries.filter((e) => e.dueSoon).length,
    [entries],
  );
  const summary = remindMutation.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Renewals
        </h1>
        <p className="text-sm text-slate-500">
          Policy renewals due within the next 90 days.
        </p>
      </header>

      {/* Send reminders control (R11.5/R11.7). */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Send renewal reminders
          </h2>
          <p className="text-xs text-slate-500">
            Notify every client whose policy renews within the selected window.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Reminder window
            <select
              value={withinDays}
              onChange={(event) => setWithinDays(Number(event.target.value))}
              disabled={remindMutation.isPending}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:opacity-60"
            >
              {REMINDER_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => remindMutation.mutate(withinDays)}
            disabled={remindMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {remindMutation.isPending && (
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden
              />
            )}
            {remindMutation.isPending ? 'Sending…' : 'Send reminders'}
          </button>
        </div>

        {remindMutation.isError && (
          <p role="alert" className="text-sm text-rose-600">
            Couldn&apos;t send reminders. Please try again.
          </p>
        )}

        {summary && (
          <div className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-emerald-600">
                {summary.sentCount}
              </span>{' '}
              reminder{summary.sentCount === 1 ? '' : 's'} sent for renewals due
              within {summary.windowDays} days.
            </p>

            {summary.failed.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-rose-600">
                  {summary.failed.length} reminder
                  {summary.failed.length === 1 ? '' : 's'} failed to send
                </p>
                <ul className="flex flex-col gap-1">
                  {summary.failed.map((recipient) => (
                    <li
                      key={recipient.renewalId}
                      className="flex items-center justify-between gap-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-slate-700"
                    >
                      <span className="font-medium text-slate-900">
                        {recipient.clientName}
                      </span>
                      <span className="text-rose-600">{recipient.reason}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => remindMutation.mutate(summary.windowDays)}
                  disabled={remindMutation.isPending}
                  className="self-start rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Retry failed recipients
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Renewal calendar (R11.2/R11.3). */}
      {renewalsQuery.isLoading ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm"
        >
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
            aria-hidden
          />
          Loading renewals…
        </div>
      ) : renewalsQuery.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <p role="alert" className="text-sm text-slate-500">
            Something went wrong loading your renewals. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void renewalsQuery.refetch()}
            className="mt-4 inline-block rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {dueSoonCount > 0 && (
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-rose-600">{dueSoonCount}</span>{' '}
              renewal{dueSoonCount === 1 ? '' : 's'} due within the next 30 days.
            </p>
          )}
          <RenewalCalendar
            entries={entries}
            currency={DEFAULT_BROKER_CURRENCY}
            limit={entries.length}
          />
        </div>
      )}
    </div>
  );
}

export default Renewals;
