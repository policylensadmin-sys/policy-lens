import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '../../lib/api';
import { RiskDashboardStrip } from '../../components/broker/RiskDashboardStrip';
import {
  ClientForm,
  type CreateClientPayload,
  type EditClientPayload,
} from '../../components/broker/ClientForm';
import { DataTable, type Column } from '../../components/broker/DataTable';
import {
  formatDate,
  humanizeKey,
  type ClientListResponse,
  type ClientResponse,
  type ClientValidationDetails,
  type ClientView,
  type RiskCategory,
  type RiskDashboardResponse,
} from '../../components/broker/types';

/**
 * Broker Clients page (R10.1–R10.5, R19.8).
 *
 * Lists the broker's clients from `GET /api/broker/clients` with name / policy
 * type / risk / renewal filters (R10.1/R10.4), a Client Risk Dashboard strip
 * from `GET /api/broker/clients/risk` (R10.3), an add-client form posting to
 * `POST /api/broker/clients` with required-field errors surfaced inline
 * (R10.5), and a client profile modal fetched from
 * `GET /api/broker/clients/:id` showing details, associated policies, and
 * coverage gaps (R10.2).
 */

const RISK_FILTER_OPTIONS: { value: RiskCategory; label: string }[] = [
  { value: 'underinsured', label: 'Underinsured' },
  { value: 'missing_family_coverage', label: 'Missing family coverage' },
  { value: 'high_deductible', label: 'High deductible' },
  { value: 'waiting_period_ending', label: 'Waiting period ending' },
  { value: 'no_health_insurance', label: 'No health insurance' },
];

const POLICY_TYPE_OPTIONS = ['health', 'life', 'motor', 'travel', 'home'];
const RENEWAL_OPTIONS = [
  { value: '', label: 'Any renewal' },
  { value: '30', label: 'Within 30 days' },
  { value: '60', label: 'Within 60 days' },
  { value: '90', label: 'Within 90 days' },
];

const inputClass =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none';

export function Clients() {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [risk, setRisk] = useState('');
  const [renewal, setRenewal] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clientsQuery = useQuery<ClientListResponse>({
    queryKey: ['broker', 'clients', { name, type, risk, renewal }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (name.trim()) params.set('name', name.trim());
      if (type) params.set('type', type);
      if (risk) params.set('risk', risk);
      if (renewal) params.set('renewalWithinDays', renewal);
      const suffix = params.toString();
      return api.get<ClientListResponse>(`/broker/clients${suffix ? `?${suffix}` : ''}`);
    },
  });

  const riskQuery = useQuery<RiskDashboardResponse>({
    queryKey: ['broker', 'clients', 'risk'],
    queryFn: () => api.get<RiskDashboardResponse>('/broker/clients/risk'),
  });

  const createMutation = useMutation<ClientResponse, ApiClientError, CreateClientPayload>({
    mutationFn: (payload) => api.post<ClientResponse>('/broker/clients', payload),
    onSuccess: () => {
      setShowAdd(false);
      createMutation.reset();
      void queryClient.invalidateQueries({ queryKey: ['broker', 'clients'] });
    },
  });

  const clients = clientsQuery.data?.clients ?? [];
  const hasFilters = Boolean(name || type || risk || renewal);

  const columns: Column<ClientView>[] = [
    {
      key: 'name',
      header: 'Client',
      render: (c) => <span className="font-medium text-slate-900">{c.fullName}</span>,
    },
    { key: 'email', header: 'Email', render: (c) => c.email ?? '—' },
    { key: 'phone', header: 'Phone', render: (c) => c.phone ?? '—' },
    {
      key: 'policies',
      header: 'Policies',
      render: (c) => c.policies.length,
    },
    {
      key: 'gaps',
      header: 'Coverage gaps',
      render: (c) =>
        c.coverageGaps.length === 0 ? (
          <span className="text-slate-400">None</span>
        ) : (
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
            {c.coverageGaps.length}
          </span>
        ),
    },
  ];

  const selectedClient = clients.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500">
            Manage your client database and spot service opportunities.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/broker/import"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            Import CSV
          </Link>
          <button
            type="button"
            onClick={() => {
              createMutation.reset();
              setShowAdd(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            + Add client
          </button>
        </div>
      </header>

      {/* Client Risk Dashboard strip (R10.3). */}
      <RiskDashboardStrip
        counts={
          riskQuery.data?.counts ?? {
            underinsured: 0,
            missing_family_coverage: 0,
            high_deductible: 0,
            waiting_period_ending: 0,
            no_health_insurance: 0,
          }
        }
      />

      {/* Filters (R10.4). */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Search by name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name"
            aria-label="Search clients by name"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Policy type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by policy type"
            className={inputClass}
          >
            <option value="">All types</option>
            {POLICY_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Risk status
          <select
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            aria-label="Filter by risk status"
            className={inputClass}
          >
            <option value="">All clients</option>
            {RISK_FILTER_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Renewal
          <select
            value={renewal}
            onChange={(e) => setRenewal(e.target.value)}
            aria-label="Filter by renewal window"
            className={inputClass}
          >
            {RENEWAL_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable<ClientView>
        columns={columns}
        rows={clients}
        rowKey={(c) => c.id}
        page={1}
        totalPages={1}
        totalCount={clients.length}
        pageSize={Math.max(clients.length, 1)}
        onPageChange={() => {}}
        isLoading={clientsQuery.isLoading}
        error={
          clientsQuery.error
            ? 'We could not load your clients. Please try again.'
            : null
        }
        emptyMessage={
          hasFilters
            ? 'No clients match your filters.'
            : 'No clients yet. Add your first client to get started.'
        }
        onRowClick={(c) => setSelectedId(c.id)}
      />

      {/* Add-client modal (R10.1/R10.5). */}
      {showAdd && (
        <Modal title="Add client" onClose={() => setShowAdd(false)}>
          <ClientForm
            mode="create"
            pending={createMutation.isPending}
            serverDetails={
              createMutation.error?.status === 422
                ? (createMutation.error.details as ClientValidationDetails)
                : null
            }
            generalError={
              createMutation.error && createMutation.error.status !== 422
                ? createMutation.error.message
                : null
            }
            onSubmitCreate={(payload) => createMutation.mutate(payload)}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {/* Client profile (R10.2). */}
      {selectedClient && (
        <Modal
          title={selectedClient.fullName}
          onClose={() => setSelectedId(null)}
          wide
        >
          <ClientProfile clientId={selectedClient.id} fallback={selectedClient} />
        </Modal>
      )}
    </div>
  );
}

/**
 * Client profile body: fetches the full profile from
 * `GET /api/broker/clients/:id` (R10.2), falling back to the list row while it
 * loads. Renders contact details, associated policies with status, and derived
 * coverage gaps.
 */
function ClientProfile({
  clientId,
  fallback,
}: {
  clientId: string;
  fallback: ClientView;
}) {
  const { data, isLoading } = useQuery<ClientResponse>({
    queryKey: ['broker', 'client', clientId],
    queryFn: () => api.get<ClientResponse>(`/broker/clients/${clientId}`),
  });

  const client = data?.client ?? fallback;

  return (
    <div className="flex flex-col gap-6">
      {isLoading && (
        <p role="status" className="text-sm text-slate-500">
          Loading profile…
        </p>
      )}

      {/* Contact details. */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Detail label="Email" value={client.email ?? '—'} />
        <Detail label="Phone" value={client.phone ?? '—'} />
        <Detail label="Policies" value={String(client.policies.length)} />
      </section>

      {/* Associated policies (R10.2). */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Associated policies</h3>
        {client.policies.length === 0 ? (
          <p className="text-sm text-slate-400">No policies on file.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
            {client.policies.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-slate-900">
                    {humanizeKey(p.policyType)}
                    {p.insurer ? ` · ${p.insurer}` : ''}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDate(p.startDate)} – {formatDate(p.endDate)}
                  </span>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {humanizeKey(p.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Coverage gaps (R10.2). */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Coverage gaps</h3>
        {client.coverageGaps.length === 0 ? (
          <p className="text-sm text-slate-400">
            No coverage gaps identified for this client.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {client.coverageGaps.map((gap) => (
              <li
                key={gap.type}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                {gap.label}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="text-sm text-slate-900">{value}</span>
    </div>
  );
}

/** Lightweight accessible modal used for the add form and client profile. */
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
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
        className={[
          'w-full rounded-xl border border-slate-200 bg-white p-6 shadow-xl',
          wide ? 'max-w-2xl' : 'max-w-xl',
        ].join(' ')}
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

export default Clients;
