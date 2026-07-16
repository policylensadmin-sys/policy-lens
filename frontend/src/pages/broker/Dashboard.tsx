import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { StatCard } from '../../components/broker/StatCard';
import { PremiumChart } from '../../components/broker/PremiumChart';
import { BusinessMixDonut } from '../../components/broker/BusinessMixDonut';
import { CommissionBreakdown } from '../../components/broker/CommissionBreakdown';
import { RenewalCalendar } from '../../components/broker/RenewalCalendar';
import { RiskDashboardStrip } from '../../components/broker/RiskDashboardStrip';
import { AIInsightList } from '../../components/broker/AIInsightList';
import { QuickActionsBar } from '../../components/broker/QuickActionsBar';
import { FileText, RefreshCw, ShieldCheck, Users, Wallet } from 'lucide-react';
import {
  formatMoneyCompact,
  type BrokerDashboard,
  type RenewalCalendar as RenewalCalendarPayload,
  type RiskDashboardResponse,
} from '../../components/broker/types';

/**
 * Broker Dashboard (R9, R13.3/13.4, R14, R19).
 *
 * Fetches the aggregated dashboard payload from `GET /api/broker/dashboard`
 * (KPIs, premium chart, commission, AI insights) plus the renewal calendar and
 * client-risk counts from their dedicated endpoints. All queries auto-refresh
 * within 60 seconds so metrics stay current without a manual refresh (R9.4).
 *
 * Layout (card-based, R19.3): Quick Actions first so they sit above the fold on
 * ≥1024px viewports (R14.3), then KPI stat cards (R9.1), charts (R9.2),
 * commission breakdown (R9.3), and the renewal / risk / AI-insight strips
 * (R13.3/13.4).
 */

/** Auto-refresh interval — keeps the dashboard fresh within 60s (R9.4). */
const REFETCH_INTERVAL_MS = 60_000;

export function Dashboard() {
  const dashboardQuery = useQuery<BrokerDashboard>({
    queryKey: ['broker', 'dashboard'],
    queryFn: () => api.get<BrokerDashboard>('/broker/dashboard'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const renewalsQuery = useQuery<RenewalCalendarPayload>({
    queryKey: ['broker', 'renewals'],
    queryFn: () => api.get<RenewalCalendarPayload>('/broker/renewals'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const riskQuery = useQuery<RiskDashboardResponse>({
    queryKey: ['broker', 'clients', 'risk'],
    queryFn: () => api.get<RiskDashboardResponse>('/broker/clients/risk'),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  if (dashboardQuery.isLoading) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
          aria-hidden
        />
        Loading your dashboard…
      </div>
    );
  }

  if (dashboardQuery.error || !dashboardQuery.data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <h1 className="font-display text-lg text-slate-900">
          Couldn&apos;t load your dashboard
        </h1>
        <p role="alert" className="mt-2 text-sm text-slate-500">
          Something went wrong loading your business metrics. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void dashboardQuery.refetch()}
          className="mt-4 inline-block rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { kpis, premiumCollection, commission, insights, currency } =
    dashboardQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500">
          Your business at a glance.
        </p>
      </header>

      {/* Quick Actions — above the fold on ≥1024px viewports (R14.1–R14.4). */}
      <QuickActionsBar
        activePolicies={kpis.activePolicies}
        renewalsDue={kpis.renewalsDue}
      />

      {/* KPI stat cards (R9.1). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total Premium (YTD)"
          value={formatMoneyCompact(kpis.totalPremiumYtd, currency)}
          icon={<Wallet size={18} strokeWidth={1.75} />}
          tone="primary"
        />
        <StatCard
          label="Active Policies"
          value={kpis.activePolicies}
          icon={<FileText size={18} strokeWidth={1.75} />}
        />
        <StatCard
          label="Total Clients"
          value={kpis.totalClients}
          icon={<Users size={18} strokeWidth={1.75} />}
        />
        <StatCard
          label="Renewals Due"
          value={kpis.renewalsDue}
          icon={<RefreshCw size={18} strokeWidth={1.75} />}
          hint="Next 30 days"
          tone={kpis.renewalsDue > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Pending Claims"
          value={kpis.pendingClaims}
          icon={<ShieldCheck size={18} strokeWidth={1.75} />}
          tone={kpis.pendingClaims > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Charts: premium collection + business mix (R9.2). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PremiumChart collection={premiumCollection} currency={currency} />
        <BusinessMixDonut collection={premiumCollection} currency={currency} />
      </div>

      {/* Commission breakdown (R9.3). */}
      <CommissionBreakdown commission={commission} />

      {/* Renewal calendar strip (R11.2/R11.3, surfaced per R9). */}
      <RenewalCalendar
        entries={renewalsQuery.data?.entries ?? []}
        currency={currency}
      />

      {/* Client risk + AI insights (R10.3, R13.3/13.4). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RiskDashboardStrip
          counts={
            riskQuery.data?.counts ?? {
              underinsured: 0,
              missing_family_coverage: 0,
              high_deductible: 0,
              waiting_period_ending: 0,
              no_health_insurance: 0,
            }
          }
        />
        <AIInsightList insights={insights} />
      </div>
    </div>
  );
}

export default Dashboard;
