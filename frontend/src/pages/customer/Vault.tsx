import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PolicyCategory } from '@policylens/shared';
import { POLICY_CATEGORIES } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';
import { PolicyCard, type VaultPolicy } from '../../components/PolicyCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';

/**
 * Policy Vault / customer home (R6).
 *
 * Lists the caller's policies from `GET /api/policies` in a card grid, each
 * showing the Health Score and category. Supports filtering by name/provider
 * (free-text `q`), category, provider, and family member (R6.2/R6.3). Cards
 * offer a signed download of the original document (R6.4/R6.7) and a
 * confirmation-gated delete that cascades analysis data (R6.5).
 *
 * Mounted at both `/app` (home) and `/app/vault`.
 */

/** Response shape for `GET /policies`. */
interface VaultListResponse {
  policies: VaultPolicy[];
}

/** Response shape for `GET /policies/:id/download`. */
interface DownloadResponse {
  url: string;
  expiresAt: string;
}

const CATEGORY_OPTIONS: { value: PolicyCategory; label: string }[] = POLICY_CATEGORIES.map(
  (c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }),
);

export function Vault() {
  const queryClient = useQueryClient();

  // Filters — `q` and `category` drive the server query; `provider` and
  // `member` are applied client-side over the returned set (R6.3).
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<PolicyCategory | ''>('');
  const [provider, setProvider] = useState('');
  const [member, setMember] = useState('');

  const [pendingDelete, setPendingDelete] = useState<VaultPolicy | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<VaultListResponse>({
    queryKey: ['policies', { q, category }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      const suffix = params.toString();
      return api.get<VaultListResponse>(`/policies${suffix ? `?${suffix}` : ''}`);
    },
  });

  const policies = data?.policies ?? [];

  // Distinct provider + family-member options built from the fetched set.
  const providerOptions = useMemo(
    () =>
      Array.from(
        new Set(policies.map((p) => p.provider).filter((p): p is string => Boolean(p))),
      ).sort(),
    [policies],
  );
  const memberOptions = useMemo(
    () =>
      Array.from(
        new Set(
          policies.map((p) => p.familyMemberId).filter((m): m is string => Boolean(m)),
        ),
      ).sort(),
    [policies],
  );

  // Client-side provider + family-member narrowing.
  const visiblePolicies = policies.filter((p) => {
    if (provider && p.provider !== provider) return false;
    if (member && p.familyMemberId !== member) return false;
    return true;
  });

  const deleteMutation = useMutation<void, ApiClientError, string>({
    mutationFn: (id) => api.delete<void>(`/policies/${id}`),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  async function handleDownload(policy: VaultPolicy) {
    setDownloadError(null);
    setDownloadingId(policy.id);
    try {
      const { url } = await api.get<DownloadResponse>(`/policies/${policy.id}/download`);
      // Open the short-lived signed URL in a new tab to start the download.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setDownloadError(
        err instanceof ApiClientError
          ? err.message
          : 'We could not prepare that download. Please try again.',
      );
    } finally {
      setDownloadingId(null);
    }
  }

  const hasFilters = Boolean(q || category || provider || member);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-accent">Your policy vault</h1>
          <p className="text-muted">All your family&apos;s coverage in one place.</p>
        </div>
        <Link
          to="/app/upload"
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
        >
          Upload a policy
        </Link>
      </header>

      {/* Filters (R6.3) */}
      <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Search
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or provider"
            aria-label="Search policies by name or provider"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PolicyCategory | '')}
            aria-label="Filter by category"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Filter by provider"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">All providers</option>
            {providerOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Family member
          <select
            value={member}
            onChange={(e) => setMember(e.target.value)}
            aria-label="Filter by family member"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">All members</option>
            {memberOptions.map((m) => (
              <option key={m} value={m}>
                {m.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {downloadError && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {downloadError}
        </p>
      )}

      {/* Loading / error / empty / grid states */}
      {isLoading ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted"
        >
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
            aria-hidden
          />
          Loading your vault…
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          We couldn&apos;t load your policies. Please refresh to try again.
        </p>
      ) : visiblePolicies.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-foreground">
            {hasFilters ? 'No policies match your filters' : 'Your vault is empty'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {hasFilters
              ? 'Try clearing or changing the filters above.'
              : 'Upload your first policy to get started.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePolicies.map((policy) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onDownload={handleDownload}
              downloading={downloadingId === policy.id}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation (R6.5) */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this policy?"
        message={
          pendingDelete
            ? `This permanently removes "${
                pendingDelete.title || pendingDelete.provider || 'this policy'
              }" and all its analysis data, embeddings, and extracted text. This can't be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        pending={deleteMutation.isPending}
        error={deleteMutation.error?.message ?? null}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            deleteMutation.reset();
            setPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete.id);
          }
        }}
      />
    </section>
  );
}

export default Vault;
