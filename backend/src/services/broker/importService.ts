// ImportService — SAFE broker CSV bulk-import (clients & policies).
//
// A broker uploads a CSV of legacy data (clients or policies). Messy input is
// normalized deterministically (and optionally repaired by AI), but EVERY row
// must pass a STRICT zod validator before it can ever be inserted. The zod
// schemas below are the single source of truth: AI output is re-validated
// against them, so the AI can never introduce an invalid row.
//
// Two-step flow:
//   • preview — parse + normalize + validate (+ optional AI fix). NO writes.
//   • commit  — server-side RE-VALIDATE every accepted row, re-resolve policy
//               client emails, then insert. Invalid rows are never inserted.
//
// Everything above the `ImportService` class is a pure, side-effect-free helper
// exported for unit testing (CSV parsing, amount/date parsing, synonym mapping,
// header aliasing, and the strict validators).

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { config } from '../../config/index';
import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import { createAiProviders } from '../ai/factory';
import type { AIProvider } from '../ai/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Importable entities. */
export type ImportEntity = 'clients' | 'policies';

/** Hard cap on the number of data rows accepted per import (safety, R). */
export const MAX_IMPORT_ROWS = 1000;

/** Canonical policy-type enum values (strict schema source of truth). */
export const POLICY_TYPES = ['health', 'life', 'motor', 'travel', 'home'] as const;

/** Canonical payment-frequency enum values. */
export const PAYMENT_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly'] as const;

/** Canonical policy-status enum values. */
export const POLICY_STATUSES = ['active', 'pending_renewal', 'expired', 'cancelled'] as const;

/** Per-row preview status. */
export type RowStatus = 'valid' | 'fixed' | 'invalid';

/** One row of a preview response. */
export interface PreviewRow {
  index: number;
  raw: Record<string, string>;
  data: Record<string, unknown> | null;
  status: RowStatus;
  aiFixed: boolean;
  notes: string[];
  errors: string[];
}

/** Full preview payload. */
export interface PreviewResult {
  entity: ImportEntity;
  rows: PreviewRow[];
  summary: { total: number; valid: number; fixed: number; invalid: number };
}

/** Commit payload. */
export interface CommitResult {
  inserted: number;
  failed: Array<{ index: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// CSV parsing (robust, dependency-free)
// ---------------------------------------------------------------------------

/** The parsed shape of a CSV string: a header row plus zero or more data rows. */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Parse a CSV string into a header row + data rows. Handles quoted fields,
 * escaped quotes (`""`), embedded commas/newlines inside quotes, and both
 * `\n` and `\r\n` line endings. Blank lines are skipped. Fully deterministic.
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const pushField = (): void => {
    record.push(field);
    field = '';
  };
  const pushRecord = (): void => {
    pushField();
    // Skip records that are entirely empty (e.g. trailing blank line).
    const isBlank = record.length === 1 && record[0]?.trim() === '';
    if (!isBlank) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
    } else if (ch === '\r') {
      // Handle CRLF: swallow the following \n (the \n branch will run next iter
      // only if we don't consume it here). Consume CR, treat as record break.
      if (text[i + 1] === '\n') i += 1;
      pushRecord();
    } else {
      field += ch;
    }
  }

  // Flush the final field/record if the input didn't end with a newline.
  if (sawAnyChar && (field.length > 0 || record.length > 0)) {
    pushRecord();
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = records;
  return { headers: (headers ?? []).map((h) => h.trim()), rows };
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/**
 * Parse a human-entered amount into a number, or `null` when it cannot be
 * understood. Handles currency symbols/words (`₹`, `Rs`, `INR`, `$`), thousands
 * separators (`18,000` and Indian `1,20,000`), and magnitude suffixes
 * (`18k`→18000, `2.5l`/`lakh`→250000, `1cr`→10000000, `3m`→3000000).
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let s = value.trim().toLowerCase();
  if (s.length === 0) return null;

  // Strip currency symbols/words, thousands separators, and whitespace.
  s = s
    .replace(/₹|\$|rs\.?|inr|usd/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (s.length === 0) return null;

  const match = s.match(/^(-?\d*\.?\d+)(k|l|lac|lakh|lakhs|m|mn|cr|crore|crores)?$/);
  if (!match) return null;

  const base = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(base)) return null;

  let multiplier = 1;
  switch (match[2]) {
    case 'k':
      multiplier = 1_000;
      break;
    case 'l':
    case 'lac':
    case 'lakh':
    case 'lakhs':
      multiplier = 100_000;
      break;
    case 'm':
    case 'mn':
      multiplier = 1_000_000;
      break;
    case 'cr':
    case 'crore':
    case 'crores':
      multiplier = 10_000_000;
      break;
    default:
      multiplier = 1;
  }

  return base * multiplier;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Zero-pad a positive integer to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** True when (y, m, d) is a real calendar date. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Build a `YYYY-MM-DD` string, or `null` when the date is not real. */
function buildIso(y: number, m: number, d: number): string | null {
  const year = y < 100 ? 2000 + y : y;
  if (!isRealDate(year, m, d)) return null;
  return `${year}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parse a human-entered date into a strict `YYYY-MM-DD` string, or `null`.
 * Supported: ISO (`2023-03-12`), `yyyy/mm/dd`, `dd/mm/yyyy` and `mm/dd/yyyy`
 * (ambiguous cases prefer `dd/mm/yyyy`), and month-name forms like
 * `12 Mar 2023`, `Mar 12, 2023`, `March 12 2023`.
 */
export function parseDateToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length === 0) return null;

  // ISO: YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // Numeric with / - or . separators.
  const parts = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    const c = Number(parts[3]);

    // yyyy/mm/dd when the first group is a 4-digit year.
    if ((parts[1] ?? '').length === 4) {
      return buildIso(a, b, c);
    }

    // Otherwise the year is last (2- or 4-digit). Disambiguate day vs month.
    if (a > 12 && b <= 12) {
      // a must be the day → dd/mm/yyyy
      return buildIso(c, b, a);
    }
    if (b > 12 && a <= 12) {
      // b must be the day → mm/dd/yyyy
      return buildIso(c, a, b);
    }
    // Ambiguous (both ≤ 12) → prefer dd/mm/yyyy.
    return buildIso(c, b, a);
  }

  // Month-name forms.
  const cleaned = s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const tokens = cleaned.split(' ');
  if (tokens.length === 3) {
    // "12 mar 2023"
    const dmY = tryMonthName(tokens[1], tokens[0], tokens[2]);
    if (dmY) return dmY;
    // "mar 12 2023"
    const mdY = tryMonthName(tokens[0], tokens[1], tokens[2]);
    if (mdY) return mdY;
  }

  return null;
}

/** Build an ISO date from a month-name token + day token + year token. */
function tryMonthName(
  monthToken: string | undefined,
  dayToken: string | undefined,
  yearToken: string | undefined,
): string | null {
  if (!monthToken || !dayToken || !yearToken) return null;
  const month = MONTHS[monthToken];
  const day = Number(dayToken);
  const year = Number(yearToken);
  if (month === undefined || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  return buildIso(year, month, day);
}

// ---------------------------------------------------------------------------
// Enum synonym normalization
// ---------------------------------------------------------------------------

/** Normalize a free-text value into a comparable key (lowercase, alnum only). */
function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map a free-text policy type onto a canonical enum value. Unknown values are
 * returned lowercased/trimmed (so the strict schema rejects them).
 */
export function normalizePolicyType(value: unknown): string {
  if (typeof value !== 'string') return '';
  const key = normKey(value);
  const synonyms: Record<string, (typeof POLICY_TYPES)[number]> = {
    health: 'health', healthinsurance: 'health', mediclaim: 'health', medical: 'health',
    life: 'life', lifeinsurance: 'life', term: 'life', termlife: 'life', terminsurance: 'life',
    motor: 'motor', motorinsurance: 'motor', vehicle: 'motor', auto: 'motor', car: 'motor',
    bike: 'motor', twowheeler: 'motor', fourwheeler: 'motor', twowheelerinsurance: 'motor',
    travel: 'travel', travelinsurance: 'travel',
    home: 'home', homeinsurance: 'home', house: 'home', property: 'home', householder: 'home',
  };
  return synonyms[key] ?? value.trim().toLowerCase();
}

/**
 * Map a free-text payment frequency onto a canonical enum value. Unknown values
 * are returned lowercased/trimmed (so the strict schema rejects them).
 */
export function normalizePaymentFrequency(value: unknown): string {
  if (typeof value !== 'string') return '';
  const key = normKey(value);
  const synonyms: Record<string, (typeof PAYMENT_FREQUENCIES)[number]> = {
    monthly: 'monthly', month: 'monthly', permonth: 'monthly',
    quarterly: 'quarterly', quarter: 'quarterly', perquarter: 'quarterly',
    halfyearly: 'half_yearly', halfyear: 'half_yearly', semiannual: 'half_yearly',
    semiannually: 'half_yearly', biannual: 'half_yearly', sixmonthly: 'half_yearly',
    yearly: 'yearly', annual: 'yearly', annually: 'yearly', perannum: 'yearly',
    peryear: 'yearly', year: 'yearly',
  };
  return synonyms[key] ?? value.trim().toLowerCase();
}

/** Map a free-text status onto a canonical enum value ('active' when blank). */
export function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return 'active';
  const key = normKey(value);
  const synonyms: Record<string, (typeof POLICY_STATUSES)[number]> = {
    active: 'active', inforce: 'active', current: 'active',
    pendingrenewal: 'pending_renewal', pending: 'pending_renewal', duerenewal: 'pending_renewal',
    expired: 'expired', lapsed: 'expired',
    cancelled: 'cancelled', canceled: 'cancelled', terminated: 'cancelled',
  };
  return synonyms[key] ?? value.trim().toLowerCase();
}

/** Keep only digits, `+`, and spaces in a phone number; collapse whitespace. */
export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\d+\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Header alias mapping
// ---------------------------------------------------------------------------

/** Canonical client fields. */
type ClientField = 'fullName' | 'email' | 'phone';
/** Canonical policy fields. */
type PolicyField =
  | 'clientEmail'
  | 'policyType'
  | 'insurer'
  | 'startDate'
  | 'endDate'
  | 'premiumAmount'
  | 'paymentFrequency'
  | 'sumInsured'
  | 'deductible'
  | 'status';

const CLIENT_HEADER_ALIASES: Record<string, ClientField> = {
  fullname: 'fullName', name: 'fullName', clientname: 'fullName', customername: 'fullName',
  client: 'fullName', customer: 'fullName',
  email: 'email', emailaddress: 'email', mail: 'email', clientemail: 'email',
  phone: 'phone', mobile: 'phone', contact: 'phone', phonenumber: 'phone',
  mobilenumber: 'phone', contactnumber: 'phone', cell: 'phone', mobileno: 'phone',
};

const POLICY_HEADER_ALIASES: Record<string, PolicyField> = {
  clientemail: 'clientEmail', email: 'clientEmail', customeremail: 'clientEmail',
  clientmail: 'clientEmail', emailaddress: 'clientEmail',
  policytype: 'policyType', type: 'policyType', producttype: 'policyType',
  insurancetype: 'policyType', category: 'policyType', plan: 'policyType',
  insurer: 'insurer', insurancecompany: 'insurer', company: 'insurer',
  provider: 'insurer', underwriter: 'insurer',
  startdate: 'startDate', start: 'startDate', doj: 'startDate', effectivedate: 'startDate',
  commencementdate: 'startDate', policystart: 'startDate', from: 'startDate', issuedate: 'startDate',
  enddate: 'endDate', end: 'endDate', expiry: 'endDate', expirydate: 'endDate',
  maturitydate: 'endDate', policyend: 'endDate', to: 'endDate', validtill: 'endDate',
  validupto: 'endDate', expiration: 'endDate',
  premiumamount: 'premiumAmount', premium: 'premiumAmount', premiumamt: 'premiumAmount',
  annualpremium: 'premiumAmount', premiumpaid: 'premiumAmount',
  paymentfrequency: 'paymentFrequency', frequency: 'paymentFrequency', paymentmode: 'paymentFrequency',
  mode: 'paymentFrequency', premiumfrequency: 'paymentFrequency', paymentterm: 'paymentFrequency',
  suminsured: 'sumInsured', coverage: 'sumInsured', coveramount: 'sumInsured',
  sumassured: 'sumInsured', si: 'sumInsured', coveragemount: 'sumInsured', coveramt: 'sumInsured',
  deductible: 'deductible', excess: 'deductible', deductibleamount: 'deductible',
  status: 'status', policystatus: 'status', state: 'status',
};

/**
 * Map a CSV header row onto canonical fields for the given entity, returning one
 * entry per column (`null` when the header is unrecognized). Deterministic and
 * alias-aware ("Client Name"→fullName, "Mobile"→phone, "Type"→policyType, …).
 */
export function mapHeaders(
  headers: string[],
  entity: ImportEntity,
): Array<ClientField | PolicyField | null> {
  const aliases: Record<string, ClientField | PolicyField> =
    entity === 'clients' ? CLIENT_HEADER_ALIASES : POLICY_HEADER_ALIASES;
  return headers.map((h) => aliases[normKey(h)] ?? null);
}

/** Build a `{ canonicalField: cellValue }` record from a mapped data row. */
function toMappedRecord(
  mapping: Array<ClientField | PolicyField | null>,
  row: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < mapping.length; i += 1) {
    const field = mapping[i];
    if (field && out[field] === undefined) {
      out[field] = row[i] ?? '';
    }
  }
  return out;
}

/** Build the `{ originalHeader: cellValue }` record used for the preview echo. */
function toRawRecord(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i += 1) {
    const key = headers[i];
    if (key !== undefined) out[key] = row[i] ?? '';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Strict schemas (SOURCE OF TRUTH — AI output is re-validated against these)
// ---------------------------------------------------------------------------

/** Strict `YYYY-MM-DD` date, verified to be a real calendar date. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return isRealDate(y ?? 0, m ?? 0, d ?? 0);
  }, 'must be a real calendar date');

/** Strict client schema. */
export const clientSchema = z.object({
  fullName: z.string().trim().min(1, 'is required'),
  email: z.string().trim().toLowerCase().pipe(z.string().email('must be a valid email')),
  phone: z.string().trim().min(1, 'is required'),
});

/** Strict policy schema (client-email existence is checked separately). */
export const policySchema = z
  .object({
    clientEmail: z.string().trim().toLowerCase().pipe(z.string().email('must be a valid email')),
    policyType: z.enum(POLICY_TYPES, {
      errorMap: () => ({ message: `must be one of ${POLICY_TYPES.join('|')}` }),
    }),
    insurer: z.string().trim().min(1, 'is required'),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    premiumAmount: z.number({ invalid_type_error: 'must be a number' }).positive('must be greater than 0'),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES, {
      errorMap: () => ({ message: `must be one of ${PAYMENT_FREQUENCIES.join('|')}` }),
    }),
    sumInsured: z.number({ invalid_type_error: 'must be a number' }).min(0, 'must be >= 0').default(0),
    deductible: z.number({ invalid_type_error: 'must be a number' }).min(0, 'must be >= 0').default(0),
    status: z
      .enum(POLICY_STATUSES, {
        errorMap: () => ({ message: `must be one of ${POLICY_STATUSES.join('|')}` }),
      })
      .default('active'),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'must be on or after startDate',
  });

/** Parsed, strictly-valid client. */
export type ValidClient = z.infer<typeof clientSchema>;
/** Parsed, strictly-valid policy. */
export type ValidPolicy = z.infer<typeof policySchema>;

/** Outcome of a strict validation attempt. */
export interface ValidationOutcome<T> {
  success: boolean;
  data: T | null;
  errors: string[];
}

/** Flatten a ZodError into human-readable `field: message` strings. */
function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Strictly validate a candidate client object. Never trusts its input — used by
 * both preview and commit so the same rules gate every insert.
 */
export function validateClient(candidate: unknown): ValidationOutcome<ValidClient> {
  const result = clientSchema.safeParse(candidate);
  if (result.success) return { success: true, data: result.data, errors: [] };
  return { success: false, data: null, errors: formatZodErrors(result.error) };
}

/**
 * Strictly validate a candidate policy object against the schema, then confirm
 * the `clientEmail` resolves to an existing client of this broker (via the
 * supplied lowercased email set). Used by both preview and commit.
 */
export function validatePolicy(
  candidate: unknown,
  knownClientEmails: ReadonlySet<string>,
): ValidationOutcome<ValidPolicy> {
  const result = policySchema.safeParse(candidate);
  if (!result.success) {
    return { success: false, data: null, errors: formatZodErrors(result.error) };
  }
  if (!knownClientEmails.has(result.data.clientEmail)) {
    return {
      success: false,
      data: null,
      errors: [`clientEmail: no existing client with email "${result.data.clientEmail}" for this broker`],
    };
  }
  return { success: true, data: result.data, errors: [] };
}

// ---------------------------------------------------------------------------
// Deterministic normalization (CSV cells → schema-shaped candidate)
// ---------------------------------------------------------------------------

/** Trim a mapped cell, returning `undefined` when the field is absent/blank. */
function cell(mapped: Record<string, string>, field: string): string | undefined {
  const value = mapped[field];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Normalize a mapped client row into a schema-shaped candidate object. */
export function normalizeClientCandidate(mapped: Record<string, string>): Record<string, unknown> {
  return {
    fullName: cell(mapped, 'fullName') ?? '',
    email: (cell(mapped, 'email') ?? '').toLowerCase(),
    phone: normalizePhone(mapped.phone ?? ''),
  };
}

/**
 * Normalize a mapped policy row into a schema-shaped candidate object. Amounts
 * are parsed; unparseable non-empty amounts become `null` (schema rejects them).
 * Optional `sumInsured`/`deductible` default to `0` when blank; `status`
 * defaults to `active`.
 */
export function normalizePolicyCandidate(mapped: Record<string, string>): Record<string, unknown> {
  const premiumRaw = cell(mapped, 'premiumAmount');
  const sumRaw = cell(mapped, 'sumInsured');
  const dedRaw = cell(mapped, 'deductible');

  return {
    clientEmail: (cell(mapped, 'clientEmail') ?? '').toLowerCase(),
    policyType: normalizePolicyType(cell(mapped, 'policyType') ?? ''),
    insurer: cell(mapped, 'insurer') ?? '',
    startDate: parseDateToIso(cell(mapped, 'startDate') ?? '') ?? (cell(mapped, 'startDate') ?? ''),
    endDate: parseDateToIso(cell(mapped, 'endDate') ?? '') ?? (cell(mapped, 'endDate') ?? ''),
    premiumAmount: premiumRaw === undefined ? undefined : parseAmount(premiumRaw),
    paymentFrequency: normalizePaymentFrequency(cell(mapped, 'paymentFrequency') ?? ''),
    sumInsured: sumRaw === undefined ? 0 : parseAmount(sumRaw),
    deductible: dedRaw === undefined ? 0 : parseAmount(dedRaw),
    status: normalizeStatus(mapped.status ?? ''),
  };
}

// ---------------------------------------------------------------------------
// CSV templates
// ---------------------------------------------------------------------------

/** Canonical template header + one example row for each entity. */
const TEMPLATES: Record<ImportEntity, { headers: string[]; example: string[] }> = {
  clients: {
    headers: ['fullName', 'email', 'phone'],
    example: ['Ravi Kumar', 'ravi.kumar@example.com', '+91 98200 11111'],
  },
  policies: {
    headers: [
      'clientEmail',
      'policyType',
      'insurer',
      'startDate',
      'endDate',
      'premiumAmount',
      'paymentFrequency',
      'sumInsured',
      'deductible',
      'status',
    ],
    example: [
      'ravi.kumar@example.com',
      'health',
      'Star Health',
      '2024-01-01',
      '2025-01-01',
      '18000',
      'yearly',
      '500000',
      '10000',
      'active',
    ],
  },
};

/** Escape a single CSV field (quote when it contains a comma/quote/newline). */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build the downloadable CSV template (header row + one example row). */
export function buildTemplateCsv(entity: ImportEntity): string {
  const tpl = TEMPLATES[entity];
  const header = tpl.headers.map(csvEscape).join(',');
  const example = tpl.example.map(csvEscape).join(',');
  return `${header}\r\n${example}\r\n`;
}

// ---------------------------------------------------------------------------
// AI-assisted repair (optional, always re-validated)
// ---------------------------------------------------------------------------

/** Extract the first balanced JSON object from a free-text AI answer. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Human-readable schema description handed to the AI as grounding. */
const SCHEMA_HINTS: Record<ImportEntity, string> = {
  clients:
    'Target JSON for a client: { "fullName": non-empty string, "email": valid email, ' +
    '"phone": non-empty string }.',
  policies:
    'Target JSON for a policy: { "clientEmail": valid email, "policyType": one of ' +
    `${POLICY_TYPES.join('|')}, "insurer": non-empty string, "startDate": "YYYY-MM-DD", ` +
    '"endDate": "YYYY-MM-DD" (>= startDate), "premiumAmount": number > 0, "paymentFrequency": one of ' +
    `${PAYMENT_FREQUENCIES.join('|')}, "sumInsured": number >= 0, "deductible": number >= 0, ` +
    `"status": one of ${POLICY_STATUSES.join('|')} }.`,
};

// ---------------------------------------------------------------------------
// Row shapes read from Supabase during commit/preview
// ---------------------------------------------------------------------------

interface ClientEmailRow {
  id: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// ImportService
// ---------------------------------------------------------------------------

/** Owns the SAFE CSV bulk-import flow for clients and policies. */
export class ImportService {
  private client?: SupabaseClient;
  private aiProvider?: AIProvider;

  constructor(client?: SupabaseClient, ai?: AIProvider) {
    this.client = client;
    this.aiProvider = ai;
  }

  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  private ai(): AIProvider {
    if (!this.aiProvider) this.aiProvider = createAiProviders({ silent: true }).ai;
    return this.aiProvider;
  }

  /** True when a live AI provider is configured (else AI repair is skipped). */
  private aiEnabled(): boolean {
    const env = config.ai;
    if (env.aiProvider === 'anthropic') return Boolean(env.anthropicApiKey);
    if (env.aiProvider === 'openai') return Boolean(env.openaiApiKey);
    return false;
  }

  /**
   * Resolve the broker id for the authenticated auth user id. Walks
   * `profiles.user_id → profiles.id → brokers.profile_id → brokers.id`.
   * Throws `403` if the user has no broker account.
   */
  async resolveBrokerId(userId: string): Promise<string> {
    const db = this.db();

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (profileError || !profile?.id) {
      throw AppError.forbidden('No profile found for the authenticated user');
    }

    const { data: broker, error: brokerError } = await db
      .from('brokers')
      .select('id')
      .eq('profile_id', profile.id as string)
      .maybeSingle();
    if (brokerError || !broker?.id) {
      throw AppError.forbidden('No broker account is associated with this user');
    }

    return broker.id as string;
  }

  /**
   * Preview an import: parse the CSV, deterministically normalize each row,
   * validate against the strict schema, and (when a live AI provider is
   * configured) attempt to repair invalid rows — always RE-VALIDATING the AI
   * output against the same strict schema. Performs NO database writes.
   */
  async preview(brokerId: string, entity: ImportEntity, csv: string): Promise<PreviewResult> {
    if (typeof csv !== 'string' || csv.trim().length === 0) {
      throw AppError.badRequest('A non-empty CSV string is required.');
    }

    const parsed = parseCsv(csv);
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw AppError.badRequest(
        `CSV exceeds the maximum of ${MAX_IMPORT_ROWS} rows (received ${parsed.rows.length}).`,
      );
    }

    const mapping = mapHeaders(parsed.headers, entity);
    const knownEmails =
      entity === 'policies' ? await this.loadClientEmailSet(brokerId) : new Set<string>();

    const rows: PreviewRow[] = [];
    for (let i = 0; i < parsed.rows.length; i += 1) {
      const dataRow = parsed.rows[i] ?? [];
      const raw = toRawRecord(parsed.headers, dataRow);
      const mapped = toMappedRecord(mapping, dataRow);
      rows.push(await this.evaluateRow(entity, i, raw, mapped, knownEmails));
    }

    const summary = rows.reduce(
      (acc, r) => {
        acc.total += 1;
        acc[r.status] += 1;
        return acc;
      },
      { total: 0, valid: 0, fixed: 0, invalid: 0 },
    );

    return { entity, rows, summary };
  }

  /**
   * Commit accepted rows. Server-side, this RE-VALIDATES every row with the
   * strict schema again (never trusting the client), re-resolves policy client
   * emails to ids within this broker, de-duplicates clients by
   * (broker_id, lower(email)), and inserts only valid rows. Invalid/duplicate
   * rows are collected in `failed` and are never inserted.
   */
  async commit(
    brokerId: string,
    entity: ImportEntity,
    inputRows: unknown[],
  ): Promise<CommitResult> {
    if (!Array.isArray(inputRows)) {
      throw AppError.badRequest('`rows` must be an array.');
    }
    if (inputRows.length > MAX_IMPORT_ROWS) {
      throw AppError.badRequest(
        `Cannot commit more than ${MAX_IMPORT_ROWS} rows (received ${inputRows.length}).`,
      );
    }

    return entity === 'clients'
      ? this.commitClients(brokerId, inputRows)
      : this.commitPolicies(brokerId, inputRows);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Evaluate a single preview row: normalize → validate → (optional) AI fix. */
  private async evaluateRow(
    entity: ImportEntity,
    index: number,
    raw: Record<string, string>,
    mapped: Record<string, string>,
    knownEmails: ReadonlySet<string>,
  ): Promise<PreviewRow> {
    const candidate =
      entity === 'clients' ? normalizeClientCandidate(mapped) : normalizePolicyCandidate(mapped);

    const outcome =
      entity === 'clients'
        ? validateClient(candidate)
        : validatePolicy(candidate, knownEmails);

    if (outcome.success) {
      return {
        index,
        raw,
        data: outcome.data as Record<string, unknown>,
        status: 'valid',
        aiFixed: false,
        notes: [],
        errors: [],
      };
    }

    // Attempt an AI repair only when a live provider is configured. The result
    // is ALWAYS re-validated against the same strict schema below.
    if (this.aiEnabled()) {
      const repaired = await this.tryAiRepair(entity, candidate);
      if (repaired) {
        const revalidated =
          entity === 'clients'
            ? validateClient(repaired)
            : validatePolicy(repaired, knownEmails);
        if (revalidated.success) {
          return {
            index,
            raw,
            data: revalidated.data as Record<string, unknown>,
            status: 'fixed',
            aiFixed: true,
            notes: ['AI normalized this row; re-validated against the strict schema.'],
            errors: [],
          };
        }
      }
    }

    return {
      index,
      raw,
      data: null,
      status: 'invalid',
      aiFixed: false,
      notes: [],
      errors: outcome.errors,
    };
  }

  /**
   * Ask the AI provider to correct a row toward the target schema and return a
   * parsed JSON object (or `null`). The caller MUST re-validate the result —
   * this method never returns trusted data.
   */
  private async tryAiRepair(
    entity: ImportEntity,
    candidate: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      const context = [
        {
          chunkIndex: 0,
          content: `${SCHEMA_HINTS[entity]} Current row (may be wrong/incomplete): ${JSON.stringify(candidate)}`,
          section: 'import-schema',
          similarity: 1,
        },
      ];
      const question =
        'Correct the current row to match the target JSON schema. Respond with ONLY a single ' +
        'JSON object of the corrected fields and no other text.';
      const answer = await this.ai().answerQuestion(context, question);
      return extractJsonObject(answer.answer);
    } catch {
      return null;
    }
  }

  /** Commit clients: re-validate, de-dup by (broker_id, lower(email)), insert. */
  private async commitClients(brokerId: string, inputRows: unknown[]): Promise<CommitResult> {
    const failed: CommitResult['failed'] = [];
    const existing = await this.loadClientEmailSet(brokerId);
    const seen = new Set<string>(existing);

    const toInsert: Array<{ index: number; row: ValidClient }> = [];
    for (let i = 0; i < inputRows.length; i += 1) {
      const outcome = validateClient(inputRows[i]);
      if (!outcome.data) {
        failed.push({ index: i, reason: outcome.errors.join('; ') || 'invalid client' });
        continue;
      }
      if (seen.has(outcome.data.email)) {
        failed.push({ index: i, reason: 'already exists' });
        continue;
      }
      seen.add(outcome.data.email);
      toInsert.push({ index: i, row: outcome.data });
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const payload = toInsert.map(({ row }) => ({
        broker_id: brokerId,
        full_name: row.fullName,
        email: row.email,
        phone: row.phone,
        risk_flags: [],
      }));
      const { data, error } = await this.db().from('clients').insert(payload).select('id');
      if (error) {
        for (const { index } of toInsert) {
          failed.push({ index, reason: `insert failed: ${error.message}` });
        }
      } else {
        inserted = (data as { id: string }[] | null)?.length ?? toInsert.length;
      }
    }

    failed.sort((a, b) => a.index - b.index);
    return { inserted, failed };
  }

  /** Commit policies: re-validate, resolve clientEmail→client_id, insert. */
  private async commitPolicies(brokerId: string, inputRows: unknown[]): Promise<CommitResult> {
    const failed: CommitResult['failed'] = [];
    const emailToId = await this.loadClientEmailMap(brokerId);
    const knownEmails = new Set<string>(emailToId.keys());

    const toInsert: Array<{ index: number; payload: Record<string, unknown> }> = [];
    for (let i = 0; i < inputRows.length; i += 1) {
      const outcome = validatePolicy(inputRows[i], knownEmails);
      if (!outcome.data) {
        failed.push({ index: i, reason: outcome.errors.join('; ') || 'invalid policy' });
        continue;
      }
      const clientId = emailToId.get(outcome.data.clientEmail);
      if (!clientId) {
        failed.push({ index: i, reason: 'client could not be resolved' });
        continue;
      }
      toInsert.push({
        index: i,
        payload: {
          broker_id: brokerId,
          client_id: clientId,
          policy_type: outcome.data.policyType,
          insurer: outcome.data.insurer,
          start_date: outcome.data.startDate,
          end_date: outcome.data.endDate,
          premium_amount: outcome.data.premiumAmount,
          payment_frequency: outcome.data.paymentFrequency,
          sum_insured: outcome.data.sumInsured,
          deductible: outcome.data.deductible,
          status: outcome.data.status,
        },
      });
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const { data, error } = await this.db()
        .from('broker_policies')
        .insert(toInsert.map((t) => t.payload))
        .select('id');
      if (error) {
        for (const { index } of toInsert) {
          failed.push({ index, reason: `insert failed: ${error.message}` });
        }
      } else {
        inserted = (data as { id: string }[] | null)?.length ?? toInsert.length;
      }
    }

    failed.sort((a, b) => a.index - b.index);
    return { inserted, failed };
  }

  /** Load the broker's client emails as a lowercased set (for existence/dedup). */
  private async loadClientEmailSet(brokerId: string): Promise<Set<string>> {
    return new Set((await this.loadClientEmailMap(brokerId)).keys());
  }

  /** Load a map of lowercased client email → client id for this broker. */
  private async loadClientEmailMap(brokerId: string): Promise<Map<string, string>> {
    const { data, error } = await this.db()
      .from('clients')
      .select('id, email')
      .eq('broker_id', brokerId);
    if (error) {
      throw AppError.internal('Failed to load broker clients', { reason: error.message });
    }
    const map = new Map<string, string>();
    for (const row of (data as ClientEmailRow[] | null) ?? []) {
      const email = (row.email ?? '').trim().toLowerCase();
      if (email.length > 0 && !map.has(email)) map.set(email, row.id);
    }
    return map;
  }
}
