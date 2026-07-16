import { formatMoney, type CommissionOverview } from './types';

/**
 * Commission Overview breakdown (R9.3).
 *
 * Shows total commission earned plus paid / pending / overdue amounts, each
 * rendered to 2 decimal places in the broker's configured currency. Overdue is
 * unpaid commission more than 30 days past its scheduled payment date.
 */
interface CommissionBreakdownProps {
  commission: CommissionOverview;
}

export function CommissionBreakdown({ commission }: CommissionBreakdownProps) {
  const { total, paid, pending, overdue, currency } = commission;

  const rows = [
    { label: 'Paid', amount: paid, tone: 'text-emerald-600' },
    { label: 'Pending', amount: pending, tone: 'text-amber-600' },
    { label: 'Overdue', amount: overdue, tone: 'text-rose-600' },
  ] as const;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-display text-sm font-semibold text-slate-900">
        Commission Overview
      </h2>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Total earned
        </span>
        <span className="font-display text-2xl font-semibold text-slate-900">
          {formatMoney(total, currency)}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 rounded-lg border border-slate-100 bg-slate-50 p-3"
          >
            <dt className="text-xs font-medium text-slate-500">{row.label}</dt>
            <dd className={`text-sm font-semibold ${row.tone}`}>
              {formatMoney(row.amount, currency)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default CommissionBreakdown;
