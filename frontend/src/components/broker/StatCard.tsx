import type { ReactNode } from 'react';

/**
 * KPI stat card for the broker dashboard (R9.1).
 *
 * Card-based layout (R19.3): white surface, subtle border, a label, a large
 * value, and an optional icon + hint. Values are pre-formatted by the caller
 * so the card stays presentation-only.
 */
interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Optional supporting text under the value (e.g. "next 30 days"). */
  hint?: string;
  /** Optional accent applied to the value (e.g. danger for pending claims). */
  tone?: 'default' | 'primary' | 'danger' | 'warning';
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-slate-900',
  primary: 'text-[#2563EB]',
  danger: 'text-rose-600',
  warning: 'text-amber-600',
};

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'default',
}: StatCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {icon && (
          <span aria-hidden className="text-lg text-slate-400">
            {icon}
          </span>
        )}
      </div>
      <span
        className={`font-display text-2xl font-semibold ${TONE_CLASSES[tone]}`}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

export default StatCard;
