import { Link } from 'react-router-dom';

/**
 * UpgradePrompt — inline premium-gate notice shown when a free-tier user hits a
 * premium-only feature (R18.4).
 *
 * Names the restricted feature and links to the upgrade page where pricing
 * options are presented. Used by the Compare and Claim Simulator pages when the
 * backend responds with an `upgrade_required` error.
 */

interface UpgradePromptProps {
  /** Human-readable feature name (e.g. "Policy Comparison"). */
  feature: string;
  /** Optional message from the backend gate to display. */
  message?: string;
}

export function UpgradePrompt({ feature, message }: UpgradePromptProps) {
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/10 p-6">
      <p className="text-xs uppercase tracking-wide text-accent">Premium feature</p>
      <h2 className="mt-1 font-display text-lg text-foreground">
        {feature} is a Premium feature
      </h2>
      <p className="mt-2 text-sm text-muted">
        {message ?? `Upgrade to Premium to unlock ${feature} and more.`}
      </p>
      <Link
        to="/app/upgrade"
        className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
      >
        See upgrade options
      </Link>
    </div>
  );
}

export default UpgradePrompt;
