import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  formatMoneyCompact,
  humanizeKey,
  type PremiumCollection,
} from './types';

/**
 * Business Mix donut — share of premium by insurance type across the 12-month
 * window (R9.2). Aggregates each type's total from the premium-collection
 * series and renders a donut with a legend. Shows an empty state when there is
 * no premium data (R9.6).
 */
interface BusinessMixDonutProps {
  collection: PremiumCollection;
  currency: string;
}

/** Categorical palette (blue-forward to match the broker primary). */
const COLORS = [
  '#2563EB',
  '#0EA5E9',
  '#14B8A6',
  '#8B5CF6',
  '#F59E0B',
  '#EF4444',
  '#10B981',
  '#EC4899',
];

export function BusinessMixDonut({ collection, currency }: BusinessMixDonutProps) {
  const totalsByType = new Map<string, number>();
  for (const point of collection.months) {
    for (const [type, amount] of Object.entries(point.byType)) {
      totalsByType.set(type, (totalsByType.get(type) ?? 0) + amount);
    }
  }

  const data = Array.from(totalsByType.entries())
    .filter(([, value]) => value > 0)
    .map(([type, value]) => ({ name: humanizeKey(type), value }))
    .sort((a, b) => b.value - a.value);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-display text-sm font-semibold text-slate-900">
        Business Mix
      </h2>
      {data.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-slate-600">No policies yet</p>
          <p className="text-xs text-slate-400">
            Your policy mix by insurance type will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-56 w-full sm:w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatMoneyCompact(value, currency)}
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
            {data.map((entry, index) => (
              <li key={entry.name} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="flex-1 text-slate-700">{entry.name}</span>
                <span className="font-medium text-slate-900">
                  {formatMoneyCompact(entry.value, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default BusinessMixDonut;
