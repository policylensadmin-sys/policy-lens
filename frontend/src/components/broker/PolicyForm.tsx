import { useState, type FormEvent } from 'react';
import type {
  ClientView,
  PolicyValidationDetails,
  PolicyView,
} from './types';

/**
 * PolicyForm — add or edit a broker policy (R11.1/R11.6).
 *
 * Collects the required policy fields (client, type, insurer, start date, end
 * date, premium amount, payment frequency) plus optional sum insured and
 * deductible. Validation errors reported by the API (`422` with `missingFields`
 * and/or `endDateBeforeStart`) are mapped to inline messages, and an
 * end-date-before-start error is surfaced explicitly (R11.6). Because the form
 * is a controlled component, all entered data is preserved on error (R11.6).
 */

/** Payload for `POST`/`PUT` `/broker/policies`. */
export interface PolicyPayload {
  clientId: string;
  policyType: string;
  insurer: string;
  startDate: string;
  endDate: string;
  premiumAmount: number;
  paymentFrequency: string;
  sumInsured?: number;
  deductible?: number;
}

interface PolicyFormProps {
  mode: 'create' | 'edit';
  /** Clients available for the client selector. */
  clients: ClientView[];
  initial?: PolicyView | null;
  pending?: boolean;
  serverDetails?: PolicyValidationDetails | null;
  generalError?: string | null;
  onSubmit: (payload: PolicyPayload) => void;
  onCancel: () => void;
}

const POLICY_TYPES = ['health', 'life', 'motor', 'travel', 'home'];
const PAYMENT_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly'];

const FIELD_LABELS: Record<string, string> = {
  clientId: 'A client must be selected',
  policyType: 'Policy type is required',
  insurer: 'Insurer is required',
  startDate: 'A valid start date is required',
  endDate: 'A valid end date is required',
  premiumAmount: 'A premium amount is required',
  paymentFrequency: 'Payment frequency is required',
};

export function PolicyForm({
  mode,
  clients,
  initial = null,
  pending = false,
  serverDetails = null,
  generalError = null,
  onSubmit,
  onCancel,
}: PolicyFormProps) {
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [policyType, setPolicyType] = useState(initial?.policyType ?? 'health');
  const [insurer, setInsurer] = useState(initial?.insurer ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [premiumAmount, setPremiumAmount] = useState(
    initial?.premiumAmount != null ? String(initial.premiumAmount) : '',
  );
  const [paymentFrequency, setPaymentFrequency] = useState(
    initial?.paymentFrequency ?? 'yearly',
  );
  const [sumInsured, setSumInsured] = useState(
    initial?.sumInsured != null ? String(initial.sumInsured) : '',
  );
  const [deductible, setDeductible] = useState(
    initial?.deductible != null ? String(initial.deductible) : '',
  );

  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [localEndBeforeStart, setLocalEndBeforeStart] = useState(false);

  const missing = new Set(serverDetails?.missingFields ?? []);
  const endBeforeStart = localEndBeforeStart || Boolean(serverDetails?.endDateBeforeStart);

  function validateLocal(): { errs: Record<string, string>; endErr: boolean } {
    const errs: Record<string, string> = {};
    if (!clientId.trim()) errs.clientId = FIELD_LABELS.clientId!;
    if (!policyType.trim()) errs.policyType = FIELD_LABELS.policyType!;
    if (!insurer.trim()) errs.insurer = FIELD_LABELS.insurer!;
    if (!startDate.trim()) errs.startDate = FIELD_LABELS.startDate!;
    if (!endDate.trim()) errs.endDate = FIELD_LABELS.endDate!;
    if (premiumAmount.trim() === '' || !Number.isFinite(Number(premiumAmount))) {
      errs.premiumAmount = FIELD_LABELS.premiumAmount!;
    }
    if (!paymentFrequency.trim()) errs.paymentFrequency = FIELD_LABELS.paymentFrequency!;

    const endErr =
      Boolean(startDate) &&
      Boolean(endDate) &&
      new Date(endDate).getTime() < new Date(startDate).getTime();

    return { errs, endErr };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const { errs, endErr } = validateLocal();
    setLocalErrors(errs);
    setLocalEndBeforeStart(endErr);
    if (Object.keys(errs).length > 0 || endErr) return;

    const num = (v: string): number | undefined => {
      const parsed = Number(v);
      return v.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
    };
    onSubmit({
      clientId: clientId.trim(),
      policyType: policyType.trim(),
      insurer: insurer.trim(),
      startDate,
      endDate,
      premiumAmount: Number(premiumAmount),
      paymentFrequency,
      sumInsured: num(sumInsured),
      deductible: num(deductible),
    });
  }

  function errorFor(field: string): string | null {
    if (localErrors[field]) return localErrors[field];
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

      {/* End-date-before-start error, surfaced explicitly (R11.6). */}
      {endBeforeStart && (
        <p
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          The end date cannot be earlier than the start date.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Client
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            aria-label="Client"
            aria-invalid={errorFor('clientId') ? true : undefined}
            className={inputClass}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
          {errorFor('clientId') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('clientId')}
            </span>
          )}
        </label>

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
            aria-invalid={errorFor('insurer') ? true : undefined}
            className={inputClass}
          />
          {errorFor('insurer') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('insurer')}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Premium amount
          <input
            type="number"
            min="0"
            value={premiumAmount}
            onChange={(e) => setPremiumAmount(e.target.value)}
            aria-label="Premium amount"
            aria-invalid={errorFor('premiumAmount') ? true : undefined}
            className={inputClass}
          />
          {errorFor('premiumAmount') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('premiumAmount')}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Start date
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
            aria-invalid={errorFor('startDate') ? true : undefined}
            className={inputClass}
          />
          {errorFor('startDate') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('startDate')}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          End date
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
            aria-invalid={errorFor('endDate') || endBeforeStart ? true : undefined}
            className={inputClass}
          />
          {errorFor('endDate') && (
            <span role="alert" className="text-xs text-rose-600">
              {errorFor('endDate')}
            </span>
          )}
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
              ? 'Add policy'
              : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

export default PolicyForm;
