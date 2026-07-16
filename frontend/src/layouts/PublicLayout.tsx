import { Link, Outlet } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * Layout for public, unauthenticated pages (Landing, Login, Signup, guest
 * preview). Uses the customer brand accent and respects the global light/dark
 * color mode. Real pages render through the nested <Outlet/> (R20).
 */
export function PublicLayout() {
  return (
    <div
      data-portal="customer"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between px-6 py-4">
        <Link to="/" className="font-display text-xl text-accent">
          PolicyLens
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <Link to="/login" className="hover:text-foreground">
            Log in
          </Link>
          <Link to="/signup" className="hover:text-foreground">
            Sign up
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export default PublicLayout;
