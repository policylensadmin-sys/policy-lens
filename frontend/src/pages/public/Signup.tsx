import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

/**
 * Account sign-up page (R17.1).
 *
 * Registers a new user via Supabase Auth with email, password, and full name.
 * Role defaults to `customer` — the `profiles` signup trigger (migration 002)
 * creates the profile row with the default role, so no role is sent here.
 *
 * Supabase may or may not return an active session depending on whether email
 * confirmation is enabled:
 * - Session present → the new customer is signed in; route to `/app`.
 * - No session → email confirmation is required; show a check-email state.
 */
export function Signup() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (signUpError) {
        throw signUpError;
      }
      if (data.session) {
        // Signed in immediately (email confirmation disabled). New users are
        // customers by default, so send them to the customer portal.
        navigate('/app', { replace: true });
      } else {
        setCheckEmail(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <section className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16 text-center">
        <h1 className="font-display text-3xl text-accent">Check your email</h1>
        <p className="text-muted">
          We sent a confirmation link to <span className="text-foreground">{email}</span>. Confirm your
          address to finish setting up your account, then sign in.
        </p>
        <Link
          to="/login"
          className="mx-auto rounded-md bg-accent px-4 py-2 font-medium text-background transition hover:opacity-90"
        >
          Go to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-accent">Create your account</h1>
        <p className="text-muted">Start understanding your insurance in minutes.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-6">
        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="fullName" className="block text-sm text-muted">
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-accent"
          />
        </div>

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
            autoComplete="new-password"
            required
            minLength={6}
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
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}

export default Signup;
