import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { humanizeKey, type BrokerDashboard } from '../../components/broker/types';

/**
 * Broker Settings page (route `/broker/settings`, R19.1/R19.8).
 *
 * A read-only summary of the broker account: agency name and contact email
 * (from the authenticated profile), configured currency (from the dashboard
 * payload), and the current plan/tier. Rendered in the broker light theme with
 * a card-based layout (R19.3). Editing agency settings is out of scope for
 * Phase 1, so fields are presented read-only.
 */
export function Settings() {
  const { profile } = useAuth();

  // Currency lives on the dashboard payload (broker's configured currency).
  const dashboardQuery = useQuery<BrokerDashboard>({
    queryKey: ['broker', 'dashboard'],
    queryFn: () => api.get<BrokerDashboard>('/broker/dashboard'),
    staleTime: 5 * 60 * 1000,
  });

  const currency = dashboardQuery.data?.currency ?? '—';
  const agencyName = profile?.fullName?.trim() || 'Your agency';
  const email = profile?.email ?? '—';
  const plan = profile?.tier ? humanizeKey(profile.tier) : '—';

  const rows: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Agency name', value: agencyName, hint: 'Displayed across the broker portal' },
    { label: 'Contact email', value: email },
    {
      label: 'Currency',
      value: dashboardQuery.isLoading ? 'Loading…' : currency,
      hint: 'Used for premium, commission, and revenue figures',
    },
    { label: 'Plan', value: plan },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Your agency account details.</p>
      </header>

      <section className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-sm font-semibold text-slate-900">Account</h2>
        <dl className="mt-3 divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-sm font-medium text-slate-500">
                {row.label}
                {row.hint && <span className="block text-xs font-normal text-slate-400">{row.hint}</span>}
              </dt>
              <dd className="text-sm font-semibold text-slate-900">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-xs text-slate-400">
        Need to change your agency details or plan? Contact support — self-service
        editing is coming in a future release.
      </p>
    </div>
  );
}

export default Settings;
