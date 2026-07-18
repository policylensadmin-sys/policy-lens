import { Link, NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo } from '../components/Brand';
import { NotificationBell } from '../components/NotificationBell';

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
  return (
    <div
      data-portal="customer"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link to="/app" aria-label="PolicyLens home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
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
        </nav>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

export default CustomerLayout;
