import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
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
 *
 * On desktop (lg and up) the sidebar is a static 240px rail. Below lg the rail
 * is hidden and the same sidebar is presented as a slide-in drawer, opened via
 * the hamburger button in the top bar and dismissed on backdrop click, Escape,
 * or after tapping a nav link.
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

const DRAWER_SIDEBAR_CLASS =
  'fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#1E293B] text-slate-100 shadow-xl transition-transform duration-200 ease-out lg:hidden';

export function BrokerLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on Escape while it's open.
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div
      data-portal="broker"
      className="flex min-h-screen bg-[#F8FAFC] text-slate-900"
    >
      {/* Desktop: static navy rail. */}
      <Sidebar className="hidden w-60 shrink-0 flex-col bg-[#1E293B] text-slate-100 lg:flex" />

      {/* Mobile/tablet: slide-in drawer + backdrop. */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <Sidebar
        className={`${DRAWER_SIDEBAR_CLASS} ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onNavigate={() => setDrawerOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            {drawerOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex flex-1 items-center justify-end gap-4">
            <NotificationBell />
            <BrokerUserBadge />
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default BrokerLayout;
