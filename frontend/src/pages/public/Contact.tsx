import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LensMark } from '../../components/Brand';

/**
 * Contact Us page. A simple, professional contact form plus direct channels.
 * The form is client-side only (no backend endpoint yet) and shows a success
 * confirmation on submit so the flow feels complete.
 */
const SUPPORT_EMAIL = 'support@policylens.app';
const SUPPORT_UPI = '8053317489@ptsbi';

export function Contact() {
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    // No backend contact endpoint yet — acknowledge locally.
    setSent(true);
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="space-y-2 text-center">
        <div className="flex justify-center">
          <LensMark className="h-10 w-10 text-primary" />
        </div>
        <h1 className="font-display text-3xl font-bold text-foreground">Contact us</h1>
        <p className="text-muted">
          Questions, feedback, or need help? We&apos;d love to hear from you.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Reach us directly</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            <li className="text-muted">
              Email:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
                {SUPPORT_EMAIL}
              </a>
            </li>
            <li className="text-muted">
              UPI (payments): <code className="text-foreground">{SUPPORT_UPI}</code>
            </li>
            <li className="text-muted">Response time: within 24–48 hours</li>
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6">
          {sent ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-2xl text-primary">
                ✓
              </span>
              <p className="font-display text-lg text-foreground">Message sent</p>
              <p className="text-sm text-muted">Thanks — we&apos;ll get back to you soon.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email"
                required
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="How can we help?"
                required
                rows={4}
                className="resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Send message
              </button>
            </form>
          )}
        </div>
      </div>

      <Link to="/" className="text-center text-sm text-muted transition hover:text-primary">
        ← Back home
      </Link>
    </section>
  );
}

export default Contact;
