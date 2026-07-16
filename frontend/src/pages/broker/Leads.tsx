import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '../../lib/api';
import { LeadForm, type LeadFormValues } from '../../components/broker/LeadForm';
import { formatTimestamp, type LeadView } from '../../components/broker/types';

/**
 * Broker Leads page (R19.4).
 *
 * Full CRUD over the broker's sales pipeline leads — name, contact, stage, and
 * notes — backed by `GET/POST/PUT/DELETE /api/broker/leads`. Creating/editing
 * uses {@link LeadForm} (name required, mirroring the backend `422`); deleting
 * is guarded by an inline confirmation.
 */

interface LeadsResponse {
  leads: LeadView[];
}

/** Local edit-modal state: closed, creating, or editing a specific lead. */
type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; lead: LeadView };

export function Leads() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<FormState>({ mode: 'closed' });
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LeadView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const leadsQuery = useQuery<LeadsResponse>({
    queryKey: ['broker', 'leads'],
    queryFn: () => api.get<LeadsResponse>('/broker/leads'),
  });

  const saveLead = useMutation({
    mutationFn: (values: LeadFormValues) => {
      const body = {
        name: values.name,
        contact: values.contact || undefined,
        stage: values.stage || undefined,
        notes: values.notes || undefined,
      };
      if (formState.mode === 'edit') {
        return api.put(`/broker/leads/${formState.lead.id}`, body);
      }
      return api.post('/broker/leads', body);
    },
    onSuccess: () => {
      setFormState({ mode: 'closed' });
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['broker', 'leads'] });
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const deleteLead = useMutation({
    mutationFn: (leadId: string) => api.delete(`/broker/leads/${leadId}`),
    onSuccess: () => {
      setPendingDelete(null);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ['broker', 'leads'] });
    },
    onError: (error: unknown) => setDeleteError(errorMessage(error)),
  });

  const leads = leadsQuery.data?.leads ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500">Track and nurture your sales pipeline.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setFormState({ mode: 'create' });
          }}
          className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          + Add lead
        </button>
      </header>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {leadsQuery.isLoading ? (
          <div role="status" className="px-5 py-8 text-center text-sm text-slate-500">
            Loading leads…
          </div>
        ) : leadsQuery.error ? (
          <div className="px-5 py-8 text-center">
            <p role="alert" className="text-sm text-rose-600">
              Couldn&apos;t load leads. Please try again.
            </p>
            <button
              type="button"
              onClick={() => void leadsQuery.refetch()}
              className="mt-3 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : leads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-600">No leads yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Add your first lead to start tracking your pipeline.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Added</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{lead.name}</td>
                    <td className="px-4 py-3 text-slate-700">{lead.contact ?? '—'}</td>
                    <td className="px-4 py-3">
                      {lead.stage ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {lead.stage}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-slate-500">
                      <span className="line-clamp-2">{lead.notes ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatTimestamp(lead.createdAt) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setFormError(null);
                            setFormState({ mode: 'edit', lead });
                          }}
                          className="text-xs font-medium text-[#2563EB] hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(lead);
                          }}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formState.mode !== 'closed' && (
        <LeadForm
          lead={formState.mode === 'edit' ? formState.lead : null}
          submitting={saveLead.isPending}
          submitError={formError}
          onSubmit={(values) => saveLead.mutateAsync(values).then(() => undefined)}
          onCancel={() => {
            setFormState({ mode: 'closed' });
            setFormError(null);
          }}
        />
      )}

      {/* Inline delete confirmation (broker light theme). */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete lead"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h2 className="font-display text-base font-semibold text-slate-900">
              Delete lead
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Remove <span className="font-medium">{pendingDelete.name}</span> from your
              pipeline? This can&apos;t be undone.
            </p>
            {deleteError && (
              <p role="alert" className="mt-3 text-sm text-rose-600">
                {deleteError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleteLead.isPending}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteLead.mutate(pendingDelete.id)}
                disabled={deleteLead.isPending}
                className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deleteLead.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Extract a user-facing message from an API error (surfacing 422 details). */
function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const details = error.details as { missingFields?: string[] } | undefined;
    if (details?.missingFields && details.missingFields.length > 0) {
      return `Missing required fields: ${details.missingFields.join(', ')}.`;
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export default Leads;
