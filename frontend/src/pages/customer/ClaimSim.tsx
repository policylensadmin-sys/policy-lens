import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ClaimResult } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';
import type { VaultPolicy } from '../../components/PolicyCard';
import { ClaimChecklist } from '../../components/ClaimChecklist';
import { UpgradePrompt } from '../../components/UpgradePrompt';

/**
 * Claim Simulator page (R8).
 *
 * The user picks a policy and describes a claim scenario in plain language,
 * then `POST /api/policies/:id/claim-sim` evaluates it. The result renders via
 * {@link ClaimChecklist}: an approval probability, per-item satisfied/warn
 * checks, supporting reasons, and any matched exclusion (R8.3/R8.4). Premium-
 * gated `upgrade_required` responses link to `/app/upgrade` (R18.4).
 */

interface VaultListResponse {
  policies: VaultPolicy[];
}

interface ClaimSimRequest {
  policyId: string;
  scenario: string;
}

function policyLabel(p: VaultPolicy): string {
  return p.title || p.provider || 'Untitled policy';
}

const MAX_SCENARIO = 1000;

export function ClaimSim() {
  const [policyId, setPolicyId] = useState('');
  const [scenario, setScenario] = useState('');

  const { data, isLoading, error, refetch } = useQuery<VaultListResponse>({
    queryKey: ['policies', { q: '', category: '' }],
    queryFn: () => api.get<VaultListResponse>('/policies'),
  });

  const policies = data?.policies ?? [];

  const mutation = useMutation<ClaimResult, ApiClientError, ClaimSimRequest>({
    mutationFn: ({ policyId: id, scenario: text }) =>
      api.post<ClaimResult>(`/policies/${id}/claim-sim`, { scenario: text }),
  });

  const trimmed = scenario.trim();
  const canSubmit = policyId !== '' && trimmed.length > 0 && !mutation.isPending;
  const upgradeRequired = mutation.error?.code === 'upgrade_required';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({ policyId, scenario: trimmed });
  }

  if (isLoading) {
    return (
      <div
        role="status"
        className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted"
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
          aria-hidden
        />
        Loading your policies…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-6 text-center">
          <h1 className="font-display text-lg text-foreground">
            Couldn&apos;t load your policies
          </h1>
          <p role="alert" className="mt-2 text-sm text-muted">
            We couldn&apos;t load your vault to run a simulation. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl text-accent">Claim simulator</h1>
        <p className="text-muted">
          Describe a claim scenario and we&apos;ll estimate whether it would be approved and what
          limitations apply.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Policy
          <select
            value={policyId}
            onChange={(e) => setPolicyId(e.target.value)}
            aria-label="Select a policy"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">Select a policy…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {policyLabel(p)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Scenario
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value.slice(0, MAX_SCENARIO))}
            rows={5}
            placeholder="e.g. I was hospitalised for 3 days for a planned knee surgery, 8 months after buying the policy."
            aria-label="Describe your claim scenario"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <span className="self-end text-[0.65rem] text-muted">
            {trimmed.length}/{MAX_SCENARIO}
          </span>
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="self-start rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Simulating…' : 'Run simulation'}
        </button>
      </form>

      {policies.length === 0 && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          You don&apos;t have any policies yet.{' '}
          <Link to="/app/upload" className="text-accent hover:underline">
            Upload a policy
          </Link>{' '}
          to run a simulation.
        </p>
      )}

      {/* Premium gate (R18.4) */}
      {upgradeRequired && (
        <UpgradePrompt feature="Claim Simulator" message={mutation.error?.message} />
      )}

      {/* Other errors, e.g. insufficient scenario detail (R8.6) */}
      {mutation.isError && !upgradeRequired && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {mutation.error?.message || 'We could not run that simulation. Please try again.'}
        </p>
      )}

      {mutation.isSuccess && <ClaimChecklist result={mutation.data} />}
    </section>
  );
}

export default ClaimSim;
