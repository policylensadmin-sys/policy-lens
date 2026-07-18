import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { LensMark } from '../../components/Brand';

/**
 * Upgrade / Payment page.
 *
 * Presents Premium pricing with two payment methods:
 *  - UPI: a scannable QR (and copyable UPI ID) for a direct transfer.
 *  - Card: shown for completeness but intentionally disabled ("not available").
 *
 * A "Skip for now" action lets the user continue with everything unlocked
 * (all features are free during the trial), regardless of payment.
 */

const UPI_ID = '8053317489@ptsbi';
const PRICE = 499;
const PAYEE_NAME = 'PolicyLens';
/** Standard UPI deep-link the QR encodes (works with any UPI app). */
const UPI_URI = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${PRICE}&cu=INR&tn=${encodeURIComponent('PolicyLens Premium')}`;

const PREMIUM_FEATURES = [
  'Unlimited policy uploads',
  'Policy Comparison — side-by-side A/B analysis',
  'Claim Simulator — estimate approval odds before you file',
  'Family vault — organize policies across members',
  'Renewal & premium tracking',
  'Ask Lens — unlimited AI questions about your policies',
];

type Method = 'upi' | 'card';

export function Upgrade() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>('upi');
  const [copied, setCopied] = useState(false);

  async function copyUpi() {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="space-y-2 text-center">
        <div className="flex justify-center">
          <LensMark className="h-10 w-10 text-primary" />
        </div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          Upgrade to <span className="text-primary">Premium</span>
        </h1>
        <p className="text-muted">
          One plan, everything unlocked — for you and your family.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Left: plan summary */}
        <div className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-extrabold text-foreground">₹{PRICE}</span>
            <span className="text-sm text-muted">/ month</span>
          </div>
          <ul className="flex flex-col gap-2.5 text-sm">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-foreground">
                <span aria-hidden className="mt-0.5 text-primary">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Secure UPI transfer · Cancel anytime · GST included
          </p>
        </div>

        {/* Right: payment methods */}
        <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6">
          {/* Method toggle */}
          <div className="flex gap-2 rounded-lg border border-border p-1">
            <button
              type="button"
              onClick={() => setMethod('upi')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                method === 'upi' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              UPI
            </button>
            <button
              type="button"
              onClick={() => setMethod('card')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                method === 'card' ? 'bg-primary text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              Card
            </button>
          </div>

          {method === 'upi' ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-muted">
                Scan the QR with any UPI app, or pay to the UPI ID below.
              </p>
              <div className="rounded-xl border border-border bg-white p-4">
                <QRCodeSVG value={UPI_URI} size={180} includeMargin />
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <code className="text-sm text-foreground">{UPI_ID}</code>
                <button
                  type="button"
                  onClick={copyUpi}
                  className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-sm font-medium text-foreground">
                Pay ₹{PRICE} to this UPI ID
              </p>
              <a
                href={UPI_URI}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Open in a UPI app
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-muted">
                Card number
                <input
                  disabled
                  placeholder="1234 5678 9012 3456"
                  className="rounded-md border border-border bg-background px-3 py-2 text-foreground opacity-60"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm text-muted">
                  Expiry
                  <input disabled placeholder="MM/YY" className="rounded-md border border-border bg-background px-3 py-2 text-foreground opacity-60" />
                </label>
                <label className="flex flex-col gap-1 text-sm text-muted">
                  CVV
                  <input disabled placeholder="123" className="rounded-md border border-border bg-background px-3 py-2 text-foreground opacity-60" />
                </label>
              </div>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-md bg-primary/40 px-4 py-2 text-sm font-medium text-white"
              >
                Pay ₹{PRICE}
              </button>
              <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                Card payments are not available right now. Please use UPI instead.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Skip — grants everything free */}
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
        <p className="text-sm text-muted">
          Not ready to pay? Everything is free during our trial.
        </p>
        <button
          type="button"
          onClick={() => navigate('/app/vault')}
          className="rounded-xl border border-primary/40 bg-primary/10 px-6 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20"
        >
          Skip for now — unlock everything free →
        </button>
      </div>

      <div className="flex items-center justify-center gap-4 text-sm text-muted">
        <Link to="/app/vault" className="transition hover:text-primary">
          ← Back to vault
        </Link>
        <span aria-hidden>·</span>
        <Link to="/contact" className="transition hover:text-primary">
          Contact us
        </Link>
      </div>
    </section>
  );
}

export default Upgrade;
