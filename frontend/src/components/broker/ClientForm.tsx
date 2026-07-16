import { useState, type FormEvent } from 'react';
import type { ClientValidationDetails, ClientView } from './types';

/**
 * ClientForm — add or edit a broker client (R10.1/R10.5).
 *
 * Create mode collects the required client fields (full name, email, phone)
 * plus one associated policy (at least its type — R10.1) with optional details.
 * Edit mode collects only the core client fields (the PUT endpoint updates
 * those). Required-field validation errors surfaced by the API (`422` with a
 * `missingFields` list) are mapped to inline per-field messages (R10.5); all
 * entered data is preserved on error because the form is a controlled component.
 */

/** Payload sent to `POST /broker/clients`. */
export interface CreateClientPayload {
  fullName: string;
  email: string;
  phone: string;
  policies: Array<{
    policyType: string;
    insurer?: string;
    startDate?: string;
    endDate?: string;
    premiumAmount?: number;
    paymentFrequency?: string;
    sumInsured?: number;
    deductible?: number;
  }>;
}

/** Payload sent to `PUT /broker/clients/:id`. */
export interface EditClientPayload {
  fullName: string;
  email: string;
  phone: string;
}

interface ClientFormProps {
  mode: 'create' | 'edit';
  /** Existing client when editing. */
  initial?: ClientView | null;
  /** True while the submit mutation is in flight. */
  pending?: boolean;
  /** Field names the server reported missing (from a `422`, R10.5). */
  serverDetails?: ClientValidationDetails | null;
  /** A general (non-field) error message to surface. */
  generalError?: string | null;
  onSubmitCreate?: (payload: CreateClientPayload) => void;
  onSubmitEdit?: (payload: EditClientPayload) => void;
  onCancel: () => void;
}

const POLICY_TYPES = ['health', 'life', 'motor', 'travel', 'home'];
const PAYMENT_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly'];

/** Human labels for the `missingFields` keys returned by the API (R10.5). */
const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name is required',
  email: 'Email is required',
  phone: 'Phone number is required',
  policies: 'At least one associated policy is required',
  'policies[].policyType': 'Each policy needs a type',
};

export function ClientForm({
  mode,
  initial = null,
  pending = false,
  serverDetails = null,
  generalError = null,
  onSubmitCreate,
  onSubmitEdit,
  onCancel,
}: ClientFormProps) {
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');

  // Associated policy (create mode only).
  const [policyType, setPolicyType] = useState('health');
  const [insurer, setInsurer] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [premiumAmount, setPremiumAmount] = useState('');
  const [paymentFrequency, setPaymentFrequency] = useState('yearly');
  const [sumInsured, setSumInsured] = useState('');
  const [deductible, setDeductible] = useState('');

  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const missing = new Set(serverDetails?.missingFields ?? []);

  function validateLocal(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = FIELD_LABELS.fullName!;
    if (!email.trim()) errs.email = FIELD_LABELS.email!;
    if (!phone.trim()) errs.phone = FIELD_LABELS.phone!;
    if (mode === 'create' && !policyType.trim()) {
      errs['policies[].policyType'] = FIELD_LABELS['policies[].policyType']!;
    }
    return errs;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errs = validateLocal();
    setClientErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (mode === 'edit') {
      onSubmitEdit?.({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      return;
    }

    const num = (v: string): number | undefined => {
      const parsed = Number(v);
      return v.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
    };
    onSubmitCreate?.({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      policies: [
        {
          policyType: policyType.trim(),
          insurer: insurer.trim() || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          premiumAmount: num(premiumAmount),
          paymentFrequency: paymentFrequency || undefined,
          sumInsured: num(sumInsured),
          deductible: num(deductible),
        },
      ],
    });
  }

  /** Merge local + server errors so both drive the inline message. */
  function errorFor(field: string): string | null {
    if (clientErrors[field]) return clientErrors[field];
    if (missing.has(field)) return FIELD_LABELS[field] ?? `${field} is required`;
    return null;
  }

  const inputClass =
    'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {generalError && (
        <p
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {generalError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Full name
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-label="Full name"
            aria-invalid={errorFor('fullName') ? true : undefined}
            className={inputClass}
          />
          {errorFor('fullName') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('fullName')}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
            aria-invalid={errorFor('email') ? true : undefined}
            className={inputClass}
          />
          {errorFor('email') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('email')}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Phone number
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label="Phone number"
            aria-invalid={errorFor('phone') ? true : undefined}
            className={inputClass}
          />
          {errorFor('phone') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('phone')}
            </span>
          )}
        </label>
      </div>

      {mode === 'create' && (
        <fieldset className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            First associated policy
          </legend>

          {(errorFor('policies') || errorFor('policies[].policyType')) && (
            <p role="alert" className="text-xs text-rose-600">
              {errorFor('policies') ?? errorFor('policies[].policyType')}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Policy type
              <select
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value)}
                aria-label="Policy type"
                className={inputClass}
              >
                {POLICY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Insurer
              <input
                type="text"
                value={insurer}
                onChange={(e) => setInsurer(e.target.value)}
                aria-label="Insurer"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Policy start date"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              End date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Policy end date"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Premium amount
              <input
                type="number"
                min="0"
                value={premiumAmount}
                onChange={(e) => setPremiumAmount(e.target.value)}
                aria-label="Premium amount"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Payment frequency
              <select
                value={paymentFrequency}
                onChange={(e) => setPaymentFrequency(e.target.value)}
                aria-label="Payment frequency"
                className={inputClass}
              >
                {PAYMENT_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f
                      .split('_')
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ')}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Sum insured
              <input
                type="number"
                min="0"
                value={sumInsured}
                onChange={(e) => setSumInsured(e.target.value)}
                aria-label="Sum insured"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Deductible
              <input
                type="number"
                min="0"
                value={deductible}
                onChange={(e) => setDeductible(e.target.value)}
                aria-label="Deductible"
                className={inputClass}
              />
            </label>
          </div>
        </fieldset>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? 'Saving…'
            : mode === 'create'
              ? 'Add client'
              : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

export default ClientForm;
