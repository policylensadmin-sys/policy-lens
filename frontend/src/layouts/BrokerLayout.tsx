import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/broker/Sidebar';

/**
 * Broker portal shell (light theme, navy sidebar — R19.3).
 *
 * Renders the persistent {@link Sidebar} (all 14 sections, R19.1/R19.2)
 * alongside a nested <Outlet/> for the broker pages (dashboard, clients,
 * policies, etc.). The broker portal uses a fixed light palette — white
 * background, navy sidebar, card-based content — per the design (R19.3).
 */
export function BrokerLayout() {
  return (
    <div
      data-portal="broker"
      className="flex min-h-screen bg-[#F8FAFC] text-slate-900"
    >
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default BrokerLayout;
