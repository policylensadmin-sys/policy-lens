import { Link, NavLink } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LineChart,
  ReceiptText,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Target,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Persistent broker navigation sidebar (R19.1, R19.2, R19.3).
 *
 * Renders all 14 portal sections as {@link NavLink}s down a fixed navy rail
 * (`#1E293B`), each with a clean line icon (lucide). The active section is
 * highlighted via the NavLink `isActive` state (blue pill, R19.2). The broker
 * portal uses a fixed light palette with a navy sidebar regardless of the
 * global light/dark mode, per the design (R19.3).
 */

interface NavSection {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The 14 broker portal sections, in navigation order (R19.1). */
export const BROKER_NAV_SECTIONS: readonly NavSection[] = [
  { to: '/broker/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/broker/clients', label: 'Clients', icon: Users },
  { to: '/broker/policies', label: 'Policies', icon: FileText },
  { to: '/broker/renewals', label: 'Renewals', icon: RefreshCw },
  { to: '/broker/premiums', label: 'Premiums', icon: Wallet },
  { to: '/broker/commission', label: 'Commission', icon: ReceiptText },
  { to: '/broker/claims', label: 'Claims', icon: ShieldCheck },
  { to: '/broker/leads', label: 'Leads', icon: Target },
  { to: '/broker/ai-assistant', label: 'AI Assistant', icon: Bot },
  { to: '/broker/reports', label: 'Reports', icon: BarChart3 },
  { to: '/broker/analytics', label: 'Analytics', icon: LineChart },
  { to: '/broker/documents', label: 'Documents', icon: FolderOpen },
  { to: '/broker/team', label: 'Team', icon: UsersRound },
  { to: '/broker/settings', label: 'Settings', icon: SettingsIcon },
] as const;

export function Sidebar() {
  return (
    <aside
      aria-label="Broker navigation"
      className="flex w-60 shrink-0 flex-col bg-[#1E293B] text-slate-100"
    >
      <div className="px-5 py-5">
        <Link
          to="/broker/dashboard"
          className="font-display text-lg font-semibold text-white"
        >
          PolicyLens
        </Link>
        <p className="mt-1 text-xs text-slate-400">Broker portal</p>
      </div>

      <nav aria-label="Sections" className="flex-1 overflow-y-auto px-3 pb-6">
        <ul className="flex flex-col gap-1">
          {BROKER_NAV_SECTIONS.map((section) => (
            <li key={section.to}>
              <NavLink
                to={section.to}
                aria-label={section.label}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white',
                  ].join(' ')
                }
              >
                {({ isActive }) => {
                  const Icon = section.icon;
                  return (
                    <>
                      <Icon aria-hidden size={18} strokeWidth={1.75} />
                      <span>{section.label}</span>
                      {isActive && (
                        <span className="sr-only"> (current section)</span>
                      )}
                    </>
                  );
                }}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

export default Sidebar;
