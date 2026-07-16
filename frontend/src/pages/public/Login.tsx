import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Email/password sign-in page (R17.1).
 *
 * Authenticates via Supabase Auth through {@link useAuth().signIn}. On success
 * the session flows into `AuthContext`, which loads the backend profile. Once
 * the profile resolves we redirect to the `redirect` query param (preserved by
 * the 401 interceptor, R17.4) or, absent that, to the role's portal home
 * (customer → `/app`, broker → `/broker`).
 */
export function Login() {
  const { signIn, user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once sign-in succeeds so the redirect effect fires when auth resolves.
  const [awaitingRedirect, setAwaitingRedirect] = useState(false);

  const redirectTo = searchParams.get('redirect');

  // Redirect once we have an authenticated user. If the profile has loaded we
  // can honour role-based routing; a `redirect` param always takes priority.
  useEffect(() => {
    if (!awaitingRedirect || !user) {
      return;
    }
    if (redirectTo) {
      navigate(redirectTo, { replace: true });
      return;
    }
    if (profile) {
      navigate(profile.role === 'broker' ? '/broker' : '/app', { replace: true });
    }
  }, [awaitingRedirect, user, profile, redirectTo, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      setAwaitingRedirect(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-accent">Welcome back</h1>
        <p className="text-muted">Sign in to your PolicyLens account.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-6">
        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-accent"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm text-muted">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-accent"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent px-4 py-2 font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-sm text-muted">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="text-accent hover:underline">
          Sign up
        </Link>
      </p>
    </section>
  );
}

export default Login;
