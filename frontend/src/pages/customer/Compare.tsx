import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ComparisonResult } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';
import type { VaultPolicy } from '../../components/PolicyCard';
import { CompareTable } from '../../components/CompareTable';
import { UpgradePrompt } from '../../components/UpgradePrompt';

/**
 * Policy Comparison page (R7).
 *
 * Lets the user pick two policies from their vault and requests a structured
 * comparison via `POST /api/compare`. The result renders through
 * {@link CompareTable} with 0–100 scores, per-row superior indicators, and a
 * recommendation (R7.3/R7.4). Premium-gated `upgrade_required` responses are
 * caught and surfaced as an upgrade prompt linking to `/app/upgrade` (R18.4).
 */

interface VaultListResponse {
  policies: VaultPolicy[];
}

interface CompareRequest {
  policyAId: string;
  policyBId: string;
}

/** Label for a policy in the picker/result. */
function policyLabel(p: VaultPolicy): string {
  return p.title || p.provider || 'Untitled policy';
}

export function Compare() {
  const [policyAId, setPolicyAId] = useState('');
  const [policyBId, setPolicyBId] = useState('');

  const { data } = useQuery<VaultListResponse>({
    queryKey: ['policies', { q: '', category: '' }],
    queryFn: () => api.get<VaultListResponse>('/policies'),
  });

  const policies = data?.policies ?? [];
  const byId = useMemo(() => new Map(policies.map((p) => [p.id, p])), [policies]);

  const mutation = useMutation<ComparisonResult, ApiClientError, CompareRequest>({
    mutationFn: (body) => api.post<ComparisonResult>('/compare', body),
  });

  const canCompare = policyAId !== '' && policyBId !== '' && policyAId !== policyBId;
  const upgradeRequired = mutation.error?.code === 'upgrade_required';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canCompare) return;
    mutation.mutate({ policyAId, policyBId });
  }

  const labelA = policyAId ? policyLabel(byId.get(policyAId) ?? ({} as VaultPolicy)) : 'Policy A';
  const labelB = policyBId ? policyLabel(byId.get(policyBId) ?? ({} as VaultPolicy)) : 'Policy B';

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl text-accent">Compare policies</h1>
        <p className="text-muted">
          Pick two policies to see a side-by-side breakdown and which offers better value.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          First policy
          <select
            value={policyAId}
            onChange={(e) => setPolicyAId(e.target.value)}
            aria-label="First policy"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">Select a policy…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id} disabled={p.id === policyBId}>
                {policyLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Second policy
          <select
            value={policyBId}
            onChange={(e) => setPolicyBId(e.target.value)}
            aria-label="Second policy"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">Select a policy…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id} disabled={p.id === policyAId}>
                {policyLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canCompare || mutation.isPending}
          className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Comparing…' : 'Compare'}
        </button>
      </form>

      {policies.length < 2 && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          You need at least two analyzed policies to compare.{' '}
          <Link to="/app/upload" className="text-accent hover:underline">
            Upload another policy
          </Link>
          .
        </p>
      )}

      {/* Premium gate (R18.4) */}
      {upgradeRequired && (
        <UpgradePrompt
          feature="Policy Comparison"
          message={mutation.error?.message}
        />
      )}

      {/* Other errors, e.g. a policy not yet analyzed (R7.5) */}
      {mutation.isError && !upgradeRequired && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {mutation.error?.message || 'We could not compare those policies. Please try again.'}
        </p>
      )}

      {mutation.isSuccess && (
        <CompareTable result={mutation.data} labelA={labelA} labelB={labelB} />
      )}
    </section>
  );
}

export default Compare;
