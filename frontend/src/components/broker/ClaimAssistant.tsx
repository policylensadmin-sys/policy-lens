import { useMemo, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { BrokerPolicyView } from './types';
import { humanizeKey } from './types';

/**
 * Claim Assistant — a step-by-step workflow for filing a claim on behalf of a
 * client (R12.4). The broker moves through sequential steps collecting the
 * required information — policy selection, incident date, incident description,
 * and supporting documents — before submission. Submission is prevented while
 * any required field is missing, and the offending step/field is indicated
 * (R12.5).
 *
 * The component is presentation + local-state only; the parent owns the
 * `POST /api/broker/claims` mutation and passes it in via {@link onSubmit}.
 */

/** The information collected by the assistant, submitted to the backend (R12.4). */
export interface ClaimAssistantValues {
  policyId: string;
  incidentDate: string;
  description: string;
  supportingDocuments: string[];
  claimType: string;
  claimedAmount: string;
}

interface ClaimAssistantProps {
  /** Broker policies to choose from (the claim is filed against one). */
  policies: BrokerPolicyView[];
  /** Whether the policy list is still loading. */
  policiesLoading?: boolean;
  /** Submit handler — resolves when the claim is created, rejects on failure. */
  onSubmit: (values: ClaimAssistantValues) => Promise<void>;
  /** Called when the broker closes/cancels the assistant. */
  onClose: () => void;
  /** True while the submit mutation is in flight. */
  submitting?: boolean;
  /** Server-side error message to surface (e.g. a failed submission). */
  submitError?: string | null;
}

/** The four sequential steps of the assistant (R12.4). */
const STEPS = ['Policy', 'Incident', 'Details', 'Documents'] as const;

/** A blank set of assistant values. */
const EMPTY_VALUES: ClaimAssistantValues = {
  policyId: '',
  incidentDate: '',
  description: '',
  supportingDocuments: [],
  claimType: '',
  claimedAmount: '',
};

export function ClaimAssistant({
  policies,
  policiesLoading = false,
  onSubmit,
  onClose,
  submitting = false,
  submitError = null,
}: ClaimAssistantProps) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<ClaimAssistantValues>(EMPTY_VALUES);
  const [docDraft, setDocDraft] = useState('');
  /** True once the broker has tried to advance/submit — reveals validation. */
  const [showErrors, setShowErrors] = useState(false);

  /** Which required field (if any) is missing for the current step (R12.5). */
  const stepError = useMemo(() => validateStep(step, values), [step, values]);

  /** All required fields missing across the whole form (for the submit gate). */
  const missingFields = useMemo(() => missingRequiredFields(values), [values]);

  function update<K extends keyof ClaimAssistantValues>(
    key: K,
    value: ClaimAssistantValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function goNext(): void {
    if (stepError) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack(): void {
    setShowErrors(false);
    setStep((s) => Math.max(s - 1, 0));
  }

  function addDocument(): void {
    const trimmed = docDraft.trim();
    if (trimmed.length === 0) {
      return;
    }
    // Use a functional update so rapid adds never read a stale array.
    setValues((prev) => ({
      ...prev,
      supportingDocuments: [...prev.supportingDocuments, trimmed],
    }));
    setDocDraft('');
  }

  function removeDocument(index: number): void {
    setValues((prev) => ({
      ...prev,
      supportingDocuments: prev.supportingDocuments.filter((_, i) => i !== index),
    }));
  }

  function handleSubmit(): void {
    // Prevent submission while required information is missing (R12.5).
    if (missingFields.length > 0) {
      setShowErrors(true);
      // Jump back to the first step that has a missing field.
      const firstBadStep = STEPS.findIndex((_, i) => validateStep(i, values));
      if (firstBadStep >= 0) {
        setStep(firstBadStep);
      }
      return;
    }
    void onSubmit(values);
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Claim Assistant"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Claim Assistant
            </h2>
            <p className="text-xs text-slate-500">
              Step {step + 1} of {STEPS.length}: {STEPS[step]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {/* Step progress indicator. */}
        <ol className="flex items-center gap-2 px-5 py-3" aria-hidden>
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  index < step
                    ? 'bg-[#2563EB] text-white'
                    : index === step
                      ? 'bg-blue-100 text-[#2563EB]'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {index + 1}
              </span>
              {index < STEPS.length - 1 && (
                <span className="h-0.5 flex-1 bg-slate-100" />
              )}
            </li>
          ))}
        </ol>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && (
            <fieldset className="flex flex-col gap-3">
              <label className="text-sm font-medium text-slate-700" htmlFor="claim-policy">
                Select a policy
              </label>
              {policiesLoading ? (
                <p className="text-sm text-slate-500">Loading policies…</p>
              ) : policies.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No policies available. Add a policy before filing a claim.
                </p>
              ) : (
                <select
                  id="claim-policy"
                  value={values.policyId}
                  onChange={(e) => update('policyId', e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="">Choose a policy…</option>
                  {policies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policyLabel(policy)}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700" htmlFor="claim-type">
                  Claim type (optional)
                </label>
                <input
                  id="claim-type"
                  type="text"
                  value={values.claimType}
                  onChange={(e) => update('claimType', e.target.value)}
                  placeholder="e.g. Hospitalisation"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset className="flex flex-col gap-3">
              <label className="text-sm font-medium text-slate-700" htmlFor="claim-incident-date">
                Incident date
              </label>
              <input
                id="claim-incident-date"
                type="date"
                value={values.incidentDate}
                onChange={(e) => update('incidentDate', e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700" htmlFor="claim-amount">
                  Claimed amount (optional)
                </label>
                <input
                  id="claim-amount"
                  type="number"
                  min="0"
                  value={values.claimedAmount}
                  onChange={(e) => update('claimedAmount', e.target.value)}
                  placeholder="0"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="claim-description">
                Incident description
              </label>
              <textarea
                id="claim-description"
                rows={5}
                value={values.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="Describe what happened…"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
              />
            </fieldset>
          )}

          {step === 3 && (
            <fieldset className="flex flex-col gap-3">
              <label className="text-sm font-medium text-slate-700" htmlFor="claim-doc">
                Supporting documents
              </label>
              <div className="flex gap-2">
                <input
                  id="claim-doc"
                  type="text"
                  value={docDraft}
                  onChange={(e) => setDocDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDocument();
                    }
                  }}
                  placeholder="e.g. discharge-summary.pdf"
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addDocument}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-[#2563EB] hover:text-[#2563EB]"
                >
                  Add
                </button>
              </div>
              {values.supportingDocuments.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {values.supportingDocuments.map((doc, index) => (
                    <li
                      key={`${doc}-${index}`}
                      className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Paperclip size={14} strokeWidth={1.75} aria-hidden />
                        {doc}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDocument(index)}
                        aria-label={`Remove ${doc}`}
                        className="shrink-0 rounded p-1 text-base leading-none text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  Add at least one supporting document to submit the claim.
                </p>
              )}
            </fieldset>
          )}

          {/* Inline validation for the current step (R12.5). */}
          {showErrors && stepError && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              {stepError}
            </p>
          )}

          {/* Submission blocked summary (R12.5). */}
          {showErrors && isLastStep && missingFields.length > 0 && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              Complete these fields before submitting:{' '}
              {missingFields.map((f) => humanizeKey(f)).join(', ')}.
            </p>
          )}

          {submitError && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              {submitError}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={step === 0 ? onClose : goBack}
            disabled={submitting}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {isLastStep ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit claim'}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Next
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** A readable label for a policy option in the selector. */
function policyLabel(policy: BrokerPolicyView): string {
  const parts = [
    policy.clientName ?? 'Unknown client',
    policy.policyType ? humanizeKey(policy.policyType) : null,
    policy.insurer,
  ].filter((p): p is string => Boolean(p));
  return parts.join(' · ');
}

/**
 * Validate the required field(s) for a single step, returning an error message
 * or null. Optional steps/fields never produce an error (R12.4/R12.5).
 */
function validateStep(step: number, values: ClaimAssistantValues): string | null {
  switch (step) {
    case 0:
      return values.policyId.trim().length === 0 ? 'Select a policy to continue.' : null;
    case 1:
      return values.incidentDate.trim().length === 0
        ? 'Enter the incident date to continue.'
        : null;
    case 2:
      return values.description.trim().length === 0
        ? 'Enter an incident description to continue.'
        : null;
    case 3:
      return values.supportingDocuments.length === 0
        ? 'Add at least one supporting document to submit.'
        : null;
    default:
      return null;
  }
}

/** The list of required fields still missing across the whole form (R12.5). */
export function missingRequiredFields(values: ClaimAssistantValues): string[] {
  const missing: string[] = [];
  if (values.policyId.trim().length === 0) missing.push('policyId');
  if (values.incidentDate.trim().length === 0) missing.push('incidentDate');
  if (values.description.trim().length === 0) missing.push('description');
  if (values.supportingDocuments.length === 0) missing.push('supportingDocuments');
  return missing;
}

export default ClaimAssistant;
