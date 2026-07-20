import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo } from '../components/Brand';
import { NotificationBell } from '../components/NotificationBell';
import { useAuth } from '../context/AuthContext';

/**
 * Customer portal shell (teal brand accent, R20.5).
 *
 * Sets `data-portal="customer"` for the brand accent and renders a top
 * navigation bar over a nested <Outlet/> that hosts the customer pages
 * (upload, vault, compare, etc.). The global light/dark mode is honored.
 */
const NAV_LINKS = [
  { to: '/app/upload', label: 'Upload' },
  { to: '/app/vault', label: 'Vault' },
  { to: '/app/compare', label: 'Compare' },
  { to: '/app/claim-sim', label: 'Claim Simulator' },
];

export function CustomerLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const displayName = profile?.fullName?.trim() || profile?.email || 'Account';

  return (
    <div
      data-portal="customer"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-4 sm:px-6">
        <Link to="/app" aria-label="PolicyLens home">
          <Logo />
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? 'text-accent' : 'text-muted hover:text-foreground'
              }
            >
              {link.label}
            </NavLink>
          ))}
          <NotificationBell />
          <ThemeToggle />
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <span
              className="hidden max-w-[12rem] truncate text-sm font-medium text-foreground sm:inline"
              title={displayName}
            >
              {displayName}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              <LogOut aria-hidden size={16} strokeWidth={1.75} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </nav>
      </header>
      <main className="flex-1 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}

export default CustomerLayout;
