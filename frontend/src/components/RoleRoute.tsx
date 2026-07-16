import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@policylens/shared';
import { useAuth } from '../context/AuthContext';

/**
 * Maps a role to its portal home. Used to bounce an authenticated user who
 * lands on a portal they aren't allowed into back to their own home (R17.5).
 */
const PORTAL_HOME: Record<Role, string> = {
  customer: '/app',
  broker: '/broker',
  corporate: '/app',
};

interface RoleRouteProps {
  /** Roles permitted to view the wrapped routes. */
  allow: Role[];
  children: ReactNode;
}

/**
 * Route guard enforcing role-based access (R17.2, R17.5).
 *
 * Behaviour:
 * - While the session/profile are still resolving, renders a lightweight
 *   spinner so we never flash a redirect based on stale state.
 * - Unauthenticated users are sent to `/login?redirect=<intended path>` so
 *   they return to where they were headed after signing in (R17.2).
 * - Authenticated users whose role is not in `allow` are redirected to their
 *   own portal home (or the not-authorized page when their role has no home),
 *   preventing cross-portal access (R17.5).
 */
export function RoleRoute({ allow, children }: RoleRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-background text-foreground"
      >
        <span
          className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent"
          aria-hidden="true"
        />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  // Not signed in → send to login, preserving the intended destination.
  if (!user) {
    const intended = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(intended)}`} replace />;
  }

  // Signed in but the profile hasn't loaded (or the role isn't permitted) →
  // bounce to the user's own portal home, or the not-authorized page.
  if (!profile || !allow.includes(profile.role)) {
    const home = profile ? PORTAL_HOME[profile.role] : undefined;
    return <Navigate to={home ?? '/not-authorized'} replace />;
  }

  return <>{children}</>;
}

export default RoleRoute;
