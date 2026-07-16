import { Link } from 'react-router-dom';
import type { RiskCategory, RiskCounts } from './types';

/**
 * Client Risk strip for the dashboard (R10.3, surfaced per R13.3).
 *
 * Renders the five Client Risk Dashboard categories with their counts as
 * compact cards. Non-zero categories are emphasised so the broker can spot
 * where attention is needed at a glance.
 */
interface RiskDashboardStripProps {
  counts: RiskCounts;
}

/** Display order + human labels for each risk category (R10.3). */
const RISK_LABELS: { key: RiskCategory; label: string }[] = [
  { key: 'underinsured', label: 'Underinsured' },
  { key: 'missing_family_coverage', label: 'Missing family coverage' },
  { key: 'high_deductible', label: 'High deductible' },
  { key: 'waiting_period_ending', label: 'Waiting period ending' },
  { key: 'no_health_insurance', label: 'No health insurance' },
];

export function RiskDashboardStrip({ counts }: RiskDashboardStripProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Client Risk
        </h2>
        <Link
          to="/broker/clients"
          className="text-xs font-medium text-[#2563EB] hover:underline"
        >
          View clients
        </Link>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {RISK_LABELS.map(({ key, label }) => {
          const count = counts[key] ?? 0;
          const active = count > 0;
          return (
            <li
              key={key}
              className={[
                'flex flex-col gap-1 rounded-lg border p-3',
                active
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-slate-100 bg-slate-50',
              ].join(' ')}
            >
              <span
                className={`font-display text-xl font-semibold ${
                  active ? 'text-amber-700' : 'text-slate-400'
                }`}
              >
                {count}
              </span>
              <span className="text-xs text-slate-500">{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default RiskDashboardStrip;
