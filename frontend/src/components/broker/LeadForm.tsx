import { useState } from 'react';
import type { LeadView } from './types';

/**
 * LeadForm — create/edit form for a broker sales lead (R19.4).
 *
 * Collects the lead's name, contact, pipeline stage, and notes. `name` is
 * required and its absence is surfaced inline (mirroring the backend `422`).
 * Presentation + local-state only; the parent owns the create/update mutation
 * and passes it in via {@link onSubmit}.
 */

/** The editable lead fields. */
export interface LeadFormValues {
  name: string;
  contact: string;
  stage: string;
  notes: string;
}

interface LeadFormProps {
  /** Existing lead when editing; omit for a create form. */
  lead?: LeadView | null;
  onSubmit: (values: LeadFormValues) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
  submitError?: string | null;
}

/** Common pipeline stages offered as suggestions (free text still allowed). */
const STAGE_OPTIONS = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];

export function LeadForm({
  lead = null,
  onSubmit,
  onCancel,
  submitting = false,
  submitError = null,
}: LeadFormProps) {
  const [values, setValues] = useState<LeadFormValues>({
    name: lead?.name ?? '',
    contact: lead?.contact ?? '',
    stage: lead?.stage ?? '',
    notes: lead?.notes ?? '',
  });
  const [showErrors, setShowErrors] = useState(false);

  const nameMissing = values.name.trim().length === 0;

  function update<K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (nameMissing) {
      setShowErrors(true);
      return;
    }
    void onSubmit({
      name: values.name.trim(),
      contact: values.contact.trim(),
      stage: values.stage.trim(),
      notes: values.notes.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={lead ? 'Edit lead' : 'Add lead'}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 className="font-display text-base font-semibold text-slate-900">
          {lead ? 'Edit lead' : 'Add lead'}
        </h2>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="lead-name">
            Name <span className="text-rose-600">*</span>
          </label>
          <input
            id="lead-name"
            type="text"
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
          {showErrors && nameMissing && (
            <p role="alert" className="text-xs text-rose-600">
              Name is required.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="lead-contact">
            Contact
          </label>
          <input
            id="lead-contact"
            type="text"
            value={values.contact}
            onChange={(e) => update('contact', e.target.value)}
            placeholder="Email or phone"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="lead-stage">
            Stage
          </label>
          <input
            id="lead-stage"
            type="text"
            list="lead-stage-options"
            value={values.stage}
            onChange={(e) => update('stage', e.target.value)}
            placeholder="e.g. Contacted"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
          <datalist id="lead-stage-options">
            {STAGE_OPTIONS.map((stage) => (
              <option key={stage} value={stage} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700" htmlFor="lead-notes">
            Notes
          </label>
          <textarea
            id="lead-notes"
            rows={3}
            value={values.notes}
            onChange={(e) => update('notes', e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
          />
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-rose-600">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : lead ? 'Save changes' : 'Add lead'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default LeadForm;
