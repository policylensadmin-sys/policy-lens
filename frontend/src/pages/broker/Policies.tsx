import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '../../lib/api';
import { DataTable, type Column } from '../../components/broker/DataTable';
import { PolicyForm, type PolicyPayload } from '../../components/broker/PolicyForm';
import {
  formatDate,
  formatMoneyCompact,
  humanizeKey,
  type ClientListResponse,
  type PolicyDisplayStatus,
  type PolicyPage,
  type PolicyResponse,
  type PolicyValidationDetails,
  type PolicyView,
} from '../../components/broker/types';

/**
 * Broker Policies page (R11.1, R11.6, R19.8).
 *
 * Renders a paginated `DataTable` of policies from `GET /api/broker/policies`
 * (≤50 per page, R11.1) with each policy's derived display status. An add/edit
 * form (`POST`/`PUT /api/broker/policies`) validates required fields and the
 * end-date-before-start rule, surfacing `422` failures inline while preserving
 * entered data (R11.6).
 */

/** Currency used for premium display until a broker-configured value is wired. */
const CURRENCY = 'INR';

const STATUS_STYLES: Record<PolicyDisplayStatus, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  'Pending Renewal': 'bg-amber-100 text-amber-700',
  Expired: 'bg-rose-100 text-rose-700',
  Cancelled: 'bg-slate-200 text-slate-600',
};

function StatusBadge({ status }: { status: PolicyDisplayStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function Policies() {
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PolicyView | null>(null);

  const policiesQuery = useQuery<PolicyPage>({
    queryKey: ['broker', 'policies', { page }],
    queryFn: () => api.get<PolicyPage>(`/broker/policies?page=${page}`),
  });

  // Clients power the policy form's client selector.
  const clientsQuery = useQuery<ClientListResponse>({
    queryKey: ['broker', 'clients', 'all'],
    queryFn: () => api.get<ClientListResponse>('/broker/clients'),
  });

  const saveMutation = useMutation<PolicyResponse, ApiClientError, PolicyPayload>({
    mutationFn: (payload) =>
      editing
        ? api.put<PolicyResponse>(`/broker/policies/${editing.id}`, payload)
        : api.post<PolicyResponse>('/broker/policies', payload),
    onSuccess: () => {
      closeForm();
      void queryClient.invalidateQueries({ queryKey: ['broker', 'policies'] });
    },
  });

  function openCreate() {
    saveMutation.reset();
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(policy: PolicyView) {
    saveMutation.reset();
    setEditing(policy);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    saveMutation.reset();
  }

  const data = policiesQuery.data;
  const policies = data?.policies ?? [];

  const columns: Column<PolicyView>[] = [
    {
      key: 'client',
      header: 'Client',
      render: (p) => (
        <span className="font-medium text-slate-900">{p.clientName ?? '—'}</span>
      ),
    },
    { key: 'type', header: 'Type', render: (p) => humanizeKey(p.policyType) },
    { key: 'insurer', header: 'Insurer', render: (p) => p.insurer ?? '—' },
    {
      key: 'term',
      header: 'Term',
      render: (p) => (
        <span className="text-xs text-slate-500">
          {formatDate(p.startDate)} – {formatDate(p.endDate)}
        </span>
      ),
    },
    {
      key: 'premium',
      header: 'Premium',
      render: (p) =>
        p.premiumAmount != null ? formatMoneyCompact(p.premiumAmount, CURRENCY) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <StatusBadge status={p.status} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (p) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openEdit(p);
          }}
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-[#2563EB] transition hover:border-[#2563EB]"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Policies</h1>
          <p className="text-sm text-slate-500">
            Track policy status, renewals, and premiums in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          + Add policy
        </button>
      </header>

      <DataTable<PolicyView>
        columns={columns}
        rows={policies}
        rowKey={(p) => p.id}
        page={data?.page ?? page}
        totalPages={data?.totalPages ?? 1}
        totalCount={data?.totalCount ?? 0}
        pageSize={data?.pageSize ?? 50}
        onPageChange={setPage}
        isLoading={policiesQuery.isLoading}
        error={
          policiesQuery.error
            ? 'We could not load your policies. Please try again.'
            : null
        }
        emptyMessage="No policies yet. Add your first policy to get started."
      />

      {showForm && (
        <Modal
          title={editing ? 'Edit policy' : 'Add policy'}
          onClose={closeForm}
        >
          <PolicyForm
            mode={editing ? 'edit' : 'create'}
            clients={clientsQuery.data?.clients ?? []}
            initial={editing}
            pending={saveMutation.isPending}
            serverDetails={
              saveMutation.error?.status === 422
                ? (saveMutation.error.details as PolicyValidationDetails)
                : null
            }
            generalError={
              saveMutation.error && saveMutation.error.status !== 422
                ? saveMutation.error.message
                : null
            }
            onSubmit={(payload) => saveMutation.mutate(payload)}
            onCancel={closeForm}
          />
        </Modal>
      )}
    </div>
  );
}

/** Lightweight accessible modal for the policy form. */
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Policies;
