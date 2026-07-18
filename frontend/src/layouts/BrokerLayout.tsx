import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/broker/Sidebar';
import { NotificationBell } from '../components/NotificationBell';
import { useAuth } from '../context/AuthContext';

/**
 * Broker portal shell (light theme, navy sidebar — R19.3).
 *
 * Renders the persistent {@link Sidebar} (all 14 sections, R19.1/R19.2)
 * alongside a nested <Outlet/> for the broker pages (dashboard, clients,
 * policies, etc.). The broker portal uses a fixed light palette — white
 * background, navy sidebar, card-based content — per the design (R19.3).
 */
/** Small identity badge in the broker top bar (name + initial avatar). */
function BrokerUserBadge() {
  const { profile } = useAuth();
  const name = profile?.fullName?.trim() || profile?.email || 'Broker';
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm font-medium text-slate-700 sm:inline">{name}</span>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563EB] text-sm font-semibold text-white">
        {initial}
      </span>
    </div>
  );
}

export function BrokerLayout() {
  return (
    <div
      data-portal="broker"
      className="flex min-h-screen bg-[#F8FAFC] text-slate-900"
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <NotificationBell />
          <BrokerUserBadge />
        </header>
        <main className="flex-1 overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default BrokerLayout;
