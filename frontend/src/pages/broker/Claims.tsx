import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLAIM_STATUSES, type ClaimStatus } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';
import {
  ClaimAssistant,
  type ClaimAssistantValues,
} from '../../components/broker/ClaimAssistant';
import {
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_STYLES,
  formatTimestamp,
  humanizeKey,
  type BrokerPolicyListResponse,
  type BrokerPolicyView,
  type ClaimListResponse,
} from '../../components/broker/types';

/**
 * Broker Claims page (R12).
 *
 * Lists all client claims with their current status (approved / under review /
 * pending / rejected), showing client name, policy number, submission date,
 * claim type, and claimed amount, paginated ≤50 per page (R12.1). Claims can be
 * filtered by status, client, policy type, and submission date range, with a
 * clear "no results" message when nothing matches (R12.3). The Claim Assistant
 * launches a sequential workflow that collects the required information and
 * prevents submission until every required field is present (R12.4/R12.5).
 *
 * Note: when a claim's status changes, the broker receives an in-app
 * notification (client name, claim reference, new status) — emitted server-side
 * by the claims service on status transitions (R12.2).
 */

const REFETCH_INTERVAL_MS = 60_000;

/** Active filter state for the claims list (R12.3). */
interface ClaimFilterState {
  status: string;
  client: string;
  policyType: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: ClaimFilterState = {
  status: '',
  client: '',
  policyType: '',
  from: '',
  to: '',
};

export function Claims() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ClaimFilterState>(EMPTY_FILTERS);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const queryString = useMemo(() => buildClaimsQuery(page, filters), [page, filters]);

  const claimsQuery = useQuery<ClaimListResponse>({
    queryKey: ['broker', 'claims', queryString],
    queryFn: () => api.get<ClaimListResponse>(`/broker/claims${queryString}`),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  // Policies for the Claim Assistant selector (loaded lazily when it opens).
  const policiesQuery = useQuery<BrokerPolicyListResponse>({
    queryKey: ['broker', 'policies', 'for-claims'],
    queryFn: () => api.get<BrokerPolicyListResponse>('/broker/policies'),
    enabled: assistantOpen,
  });

  const submitClaim = useMutation({
    mutationFn: (values: ClaimAssistantValues) =>
      api.post('/broker/claims', {
        policyId: values.policyId,
        incidentDate: values.incidentDate,
        description: values.description,
        supportingDocuments: values.supportingDocuments,
        claimType: values.claimType || undefined,
        claimedAmount: values.claimedAmount ? Number(values.claimedAmount) : undefined,
      }),
    onSuccess: () => {
      setAssistantOpen(false);
      setSubmitError(null);
      void queryClient.invalidateQueries({ queryKey: ['broker', 'claims'] });
    },
    onError: (error: unknown) => {
      setSubmitError(errorMessage(error));
    },
  });

  function updateFilter<K extends keyof ClaimFilterState>(
    key: K,
    value: ClaimFilterState[K],
  ): void {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters(): void {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }

  const data = claimsQuery.data;
  const claims = data?.claims ?? [];
  const hasActiveFilters = Object.values(filters).some((v) => v.trim().length > 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Claims</h1>
          <p className="text-sm text-slate-500">
            Track and file claims across all your clients.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSubmitError(null);
            setAssistantOpen(true);
          }}
          className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          + Claim Assistant
        </button>
      </header>

      {/* Filters (R12.3). */}
      <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Status
          <select
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          >
            <option value="">All statuses</option>
            {CLAIM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CLAIM_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Client
          <input
            type="text"
            value={filters.client}
            onChange={(e) => updateFilter('client', e.target.value)}
            placeholder="Client id"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Policy type
          <input
            type="text"
            value={filters.policyType}
            onChange={(e) => updateFilter('policyType', e.target.value)}
            placeholder="e.g. health"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => updateFilter('from', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          To
          <input
            type="date"
            value={filters.to}
            onChange={(e) => updateFilter('to', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
        </label>
        {hasActiveFilters && (
          <div className="sm:col-span-2 lg:col-span-5">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-[#2563EB] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      {/* Claims table (R12.1). */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {claimsQuery.isLoading ? (
          <div role="status" className="px-5 py-8 text-center text-sm text-slate-500">
            Loading claims…
          </div>
        ) : claimsQuery.error ? (
          <div className="px-5 py-8 text-center">
            <p role="alert" className="text-sm text-rose-600">
              Couldn&apos;t load claims. Please try again.
            </p>
            <button
              type="button"
              onClick={() => void claimsQuery.refetch()}
              className="mt-3 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : claims.length === 0 ? (
          // No-results message (R12.3).
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-600">No claims found</p>
            <p className="mt-1 text-xs text-slate-400">
              {hasActiveFilters
                ? 'No claims match the selected filters. Try adjusting or clearing them.'
                : 'Claims filed for your clients will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Policy #</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900">
                      {claim.clientName ?? 'Unknown client'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {claim.policyNumber || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {claim.claimType ? humanizeKey(claim.claimType) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatTimestamp(claim.submittedAt) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {claim.claimedAmount === null
                        ? '—'
                        : claim.claimedAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLAIM_STATUS_STYLES[claim.status]}`}
                      >
                        {statusLabel(claim.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pagination (≤50/page, R12.1). */}
      {data && data.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Page {data.page} of {data.totalPages} · {data.totalCount} claim
            {data.totalCount === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={data.page >= data.totalPages}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      )}

      {assistantOpen && (
        <ClaimAssistant
          policies={policiesQuery.data?.policies ?? ([] as BrokerPolicyView[])}
          policiesLoading={policiesQuery.isLoading}
          submitting={submitClaim.isPending}
          submitError={submitError}
          onSubmit={(values) => submitClaim.mutateAsync(values).then(() => undefined)}
          onClose={() => {
            setAssistantOpen(false);
            setSubmitError(null);
          }}
        />
      )}
    </div>
  );
}

/** Map a claim status to its display label, falling back to a humanized key. */
function statusLabel(status: ClaimStatus): string {
  return CLAIM_STATUS_LABELS[status] ?? humanizeKey(status);
}

/** Build the query string for the claims list from page + filters (R12.3). */
function buildClaimsQuery(page: number, filters: ClaimFilterState): string {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (filters.status) params.set('status', filters.status);
  if (filters.client.trim()) params.set('client', filters.client.trim());
  if (filters.policyType.trim()) params.set('policyType', filters.policyType.trim());
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Extract a user-facing message from an API error (surfacing 422 details). */
function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const details = error.details as { missingFields?: string[] } | undefined;
    if (details?.missingFields && details.missingFields.length > 0) {
      return `Missing required information: ${details.missingFields
        .map((f) => humanizeKey(f))
        .join(', ')}.`;
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export default Claims;
