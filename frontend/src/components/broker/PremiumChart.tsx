import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatMoneyCompact,
  formatMonthLabel,
  type PremiumCollection,
} from './types';

/**
 * Premium Collection chart — monthly totals over the last 12 months, with a
 * per-type breakdown available on hover (R9.2). Renders an empty-state card
 * when the window contains no premium at all (R9.6).
 */
interface PremiumChartProps {
  collection: PremiumCollection;
  currency: string;
}

export function PremiumChart({ collection, currency }: PremiumChartProps) {
  if (collection.empty || collection.months.length === 0) {
    return (
      <ChartShell>
        <div className="flex h-64 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-slate-600">
            No premium collected yet
          </p>
          <p className="text-xs text-slate-400">
            Premium collection will appear here once policies are recorded.
          </p>
        </div>
      </ChartShell>
    );
  }

  const data = collection.months.map((point) => ({
    month: formatMonthLabel(point.month),
    total: point.total,
    byType: point.byType,
  }));

  return (
    <ChartShell>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: '#64748B', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: '#E2E8F0' }}
            />
            <YAxis
              tick={{ fill: '#64748B', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: '#E2E8F0' }}
              width={72}
              tickFormatter={(value: number) => formatMoneyCompact(value, currency)}
            />
            <Tooltip
              formatter={(value: number) => formatMoneyCompact(value, currency)}
              labelStyle={{ color: '#0F172A' }}
              contentStyle={{
                borderRadius: 8,
                border: '1px solid #E2E8F0',
                fontSize: 12,
              }}
            />
            <Bar dataKey="total" fill="#2563EB" radius={[4, 4, 0, 0]} name="Premium" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function ChartShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Premium Collection
        </h2>
        <span className="text-xs text-slate-400">Last 12 months</span>
      </div>
      {children}
    </section>
  );
}

export default PremiumChart;
