import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Upgrade page (R18.2, R18.4).
 *
 * Presents the two subscription tiers side by side and names the premium
 * features unlocked by upgrading — Claim Simulator, Policy Comparison, family
 * vault, renewal tracking, and unlimited uploads (R18.2/R18.3). Reached from
 * the premium-gate prompts on the Compare and Claim Simulator pages.
 */

/** Premium capabilities named on the upgrade page (R18.2/R18.4). */
const PREMIUM_FEATURES = [
  'Unlimited policy uploads (Free tier is capped at 3)',
  'Policy Comparison — side-by-side A/B analysis with recommendations',
  'Claim Simulator — estimate approval probability before you file',
  'Family vault — organize policies across family members',
  'Renewal tracking — never miss a renewal date',
  'Full AI analysis with no tier-imposed restrictions',
];

interface Tier {
  name: string;
  price: string;
  cadence: string;
  highlight: boolean;
  features: string[];
  cta: string;
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '₹0',
    cadence: 'forever',
    highlight: false,
    features: [
      'Up to 3 policy uploads',
      'Health Score',
      'Coverage summary',
      'Exclusions list',
    ],
    cta: 'Current plan',
  },
  {
    name: 'Premium',
    price: '₹499',
    cadence: 'per month',
    highlight: true,
    features: [
      'Everything in Free',
      'Unlimited uploads',
      'Policy Comparison',
      'Claim Simulator',
      'Family vault & renewal tracking',
    ],
    cta: 'Upgrade to Premium',
  },
];

export function Upgrade() {
  const { profile } = useAuth();
  const isPremium = profile?.tier === 'premium';

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-accent">Upgrade to Premium</h1>
        <p className="text-muted">
          Unlock the full power of PolicyLens for you and your family.
        </p>
        {isPremium && (
          <p className="text-sm text-accent">You&apos;re on the Premium plan — thank you!</p>
        )}
      </header>

      {/* Named premium features (R18.4) */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg text-foreground">What you get with Premium</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {PREMIUM_FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-muted">
              <span aria-hidden className="mt-0.5 text-accent">
                ✓
              </span>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      {/* Pricing tiers (R18.4) */}
      <div className="grid gap-4 sm:grid-cols-2">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`flex flex-col gap-4 rounded-xl border bg-surface p-6 ${
              tier.highlight ? 'border-accent' : 'border-border'
            }`}
          >
            <div>
              <h3 className="font-display text-xl text-foreground">{tier.name}</h3>
              <p className="mt-1">
                <span className="font-display text-3xl text-foreground">{tier.price}</span>{' '}
                <span className="text-sm text-muted">{tier.cadence}</span>
              </p>
            </div>
            <ul className="flex flex-1 flex-col gap-2 text-sm text-muted">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-accent">
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            {tier.name === 'Premium' ? (
              <button
                type="button"
                disabled={isPremium}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPremium ? 'Active' : tier.cta}
              </button>
            ) : (
              <span className="rounded-md border border-border px-4 py-2 text-center text-sm text-muted">
                {isPremium ? 'Free' : tier.cta}
              </span>
            )}
          </div>
        ))}
      </div>

      <Link to="/app/vault" className="text-center text-sm text-muted transition hover:text-accent">
        ← Back to your vault
      </Link>
    </section>
  );
}

export default Upgrade;
