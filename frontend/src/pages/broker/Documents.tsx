import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '../../lib/api';
import {
  formatDate,
  humanizeKey,
  type DocumentsResponse,
  type DocumentView,
} from '../../components/broker/types';

/**
 * Broker Documents page (route `/broker/documents`, R19.6).
 *
 * Lets the broker upload documents (multipart → `POST /api/broker/documents`),
 * delete them (`DELETE /api/broker/documents/:id`), and filter/categorize the
 * library by client, policy, or category (`GET /api/broker/documents`). Client
 * and policy associations are chosen from the broker's own records so uploads
 * are always categorized (R19.6). Light, card-based layout per R19.3.
 */

interface ClientOption {
  id: string;
  fullName: string;
}
interface PolicyOption {
  id: string;
  clientId: string;
  clientName: string | null;
  policyType: string;
  insurer: string | null;
}

export function Documents() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters (categorize the library by client / policy / category).
  const [filterClientId, setFilterClientId] = useState('');
  const [filterPolicyId, setFilterPolicyId] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Upload form state.
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [clientId, setClientId] = useState('');
  const [brokerPolicyId, setBrokerPolicyId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<DocumentView | null>(null);

  // Association options for categorization dropdowns.
  const clientsQuery = useQuery<{ clients: ClientOption[] }>({
    queryKey: ['broker', 'clients', 'options'],
    queryFn: () => api.get<{ clients: ClientOption[] }>('/broker/clients'),
  });
  const policiesQuery = useQuery<{ policies: PolicyOption[] }>({
    queryKey: ['broker', 'policies', 'options'],
    queryFn: () => api.get<{ policies: PolicyOption[] }>('/broker/policies?pageSize=50'),
  });

  const clients = clientsQuery.data?.clients ?? [];
  const policies = policiesQuery.data?.policies ?? [];

  const clientName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.fullName);
    return map;
  }, [clients]);
  const policyLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of policies) {
      map.set(p.id, `${humanizeKey(p.policyType)}${p.insurer ? ` · ${p.insurer}` : ''}`);
    }
    return map;
  }, [policies]);

  const documentsQuery = useQuery<DocumentsResponse>({
    queryKey: ['broker', 'documents', filterClientId, filterPolicyId, filterCategory],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterClientId) params.set('clientId', filterClientId);
      if (filterPolicyId) params.set('policyId', filterPolicyId);
      if (filterCategory) params.set('category', filterCategory);
      const qs = params.toString();
      return api.get<DocumentsResponse>(`/broker/documents${qs ? `?${qs}` : ''}`);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (form: FormData) => api.post<{ document: DocumentView }>('/broker/documents', form),
    onSuccess: () => {
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ['broker', 'documents'] });
    },
    onError: (err: unknown) => {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Failed to upload the document. Please try again.',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/broker/documents/${id}`),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['broker', 'documents'] });
    },
  });

  function resetForm() {
    setFile(null);
    setName('');
    setCategory('');
    setClientId('');
    setBrokerPolicyId('');
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!file) {
      setFormError('Please choose a file to upload.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (name.trim()) form.append('name', name.trim());
    if (category.trim()) form.append('category', category.trim());
    if (clientId) form.append('clientId', clientId);
    if (brokerPolicyId) form.append('brokerPolicyId', brokerPolicyId);
    uploadMutation.mutate(form);
  }

  const documents = documentsQuery.data?.documents ?? [];
  const hasFilters = Boolean(filterClientId || filterPolicyId || filterCategory);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          Documents
        </h1>
        <p className="text-sm text-slate-500">
          Upload, categorize, and manage documents by client or policy.
        </p>
      </header>

      {/* Upload form (R19.6). */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-sm font-semibold text-slate-900">Upload document</h2>
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={handleUpload}>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">File (PDF, JPEG, or PNG)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Display name (optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to the file name"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Category (optional)</span>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Policy Document, ID Proof"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Client (optional)</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Policy (optional)</span>
            <select
              value={brokerPolicyId}
              onChange={(e) => setBrokerPolicyId(e.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
            >
              <option value="">No policy</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {humanizeKey(p.policyType)}
                  {p.clientName ? ` · ${p.clientName}` : ''}
                </option>
              ))}
            </select>
          </label>

          {formError && (
            <p role="alert" className="sm:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </p>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={uploadMutation.isPending}
              className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload document'}
            </button>
          </div>
        </form>
      </section>

      {/* Filters (R19.6). */}
      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Filter by client</span>
          <select
            value={filterClientId}
            onChange={(e) => setFilterClientId(e.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Filter by policy</span>
          <select
            value={filterPolicyId}
            onChange={(e) => setFilterPolicyId(e.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">All policies</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {humanizeKey(p.policyType)}
                {p.clientName ? ` · ${p.clientName}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Filter by category</span>
          <input
            type="text"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            placeholder="Category label"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setFilterClientId('');
              setFilterPolicyId('');
              setFilterCategory('');
            }}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:border-slate-300"
          >
            Clear filters
          </button>
        )}
      </section>

      {/* Document list (R19.6). */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Library
          <span className="ml-2 text-xs font-normal text-slate-400">
            {documents.length} document{documents.length === 1 ? '' : 's'}
          </span>
        </h2>

        {documentsQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading documents…</p>
        ) : documentsQuery.error ? (
          <p role="alert" className="py-6 text-center text-sm text-rose-600">
            Couldn&apos;t load documents. Please try again.
          </p>
        ) : documents.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {hasFilters
              ? 'No documents match the selected filters.'
              : 'No documents yet. Upload your first document above.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{doc.name}</p>
                  <p className="text-xs text-slate-500">
                    Added {formatDate(doc.createdAt)}
                    {doc.clientId && clientName.has(doc.clientId)
                      ? ` · ${clientName.get(doc.clientId)}`
                      : ''}
                    {doc.brokerPolicyId && policyLabel.has(doc.brokerPolicyId)
                      ? ` · ${policyLabel.get(doc.brokerPolicyId)}`
                      : ''}
                  </p>
                </div>
                {doc.category && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {doc.category}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPendingDelete(doc)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Delete confirmation. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete document"
          message={`Delete "${pendingDelete.name}"? This permanently removes the file and cannot be undone.`}
          pending={deleteMutation.isPending}
          error={deleteMutation.error instanceof ApiClientError ? deleteMutation.error.message : null}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => {
            if (!deleteMutation.isPending) {
              deleteMutation.reset();
              setPendingDelete(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** Light-themed confirmation modal for destructive broker actions (R19.3). */
function ConfirmModal({
  title,
  message,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => !pending && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Documents;
