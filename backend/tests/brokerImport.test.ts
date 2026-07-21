// Unit tests for the SAFE CSV bulk-import helpers (broker portal).
//
// These exercise the pure, side-effect-free logic in `importService`: CSV
// parsing, amount/date normalization, enum-synonym mapping, header aliasing,
// and — most importantly — the STRICT validators that gate every insert. The
// last block asserts the commit-time validator rejects deliberately bad rows,
// which is the core safety guarantee (invalid data can never be inserted).

import { describe, expect, it } from 'vitest';

import {
  buildTemplateCsv,
  extractJsonObject,
  mapHeaders,
  normalizeClientCandidate,
  normalizePaymentFrequency,
  normalizePolicyCandidate,
  normalizePolicyType,
  normalizeStatus,
  normalizePhone,
  parseAmount,
  parseCsv,
  parseDateToIso,
  validateClient,
  validatePolicy,
} from '../src/services/broker/importService';

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('parses a simple CSV with a header + data rows', () => {
    const { headers, rows } = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with embedded commas, quotes, and newlines', () => {
    const csv = 'name,note\n"Doe, Jane","She said ""hi""\nline2"\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['name', 'note']);
    expect(rows).toEqual([['Doe, Jane', 'She said "hi"\nline2']]);
  });

  it('handles CRLF line endings and skips blank lines', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('returns empty structures for an empty string', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

describe('parseAmount', () => {
  it('parses plain numbers and thousands separators', () => {
    expect(parseAmount('18000')).toBe(18000);
    expect(parseAmount('18,000')).toBe(18000);
    expect(parseAmount('1,20,000')).toBe(120000);
    expect(parseAmount(4200)).toBe(4200);
  });

  it('strips currency symbols and words', () => {
    expect(parseAmount('₹18,000')).toBe(18000);
    expect(parseAmount('Rs. 2500')).toBe(2500);
    expect(parseAmount('INR 999')).toBe(999);
    expect(parseAmount('$ 50')).toBe(50);
  });

  it('applies magnitude suffixes', () => {
    expect(parseAmount('18k')).toBe(18000);
    expect(parseAmount('2.5k')).toBe(2500);
    expect(parseAmount('5l')).toBe(500000);
    expect(parseAmount('2lakh')).toBe(200000);
    expect(parseAmount('1cr')).toBe(10000000);
    expect(parseAmount('3m')).toBe(3000000);
  });

  it('returns null for unparseable input', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12x')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

describe('parseDateToIso', () => {
  it('accepts ISO dates', () => {
    expect(parseDateToIso('2023-03-12')).toBe('2023-03-12');
    expect(parseDateToIso('2023-3-5')).toBe('2023-03-05');
  });

  it('parses dd/mm/yyyy (preferred) and unambiguous mm/dd/yyyy', () => {
    expect(parseDateToIso('12/03/2023')).toBe('2023-03-12'); // ambiguous → dd/mm
    expect(parseDateToIso('25/12/2023')).toBe('2023-12-25'); // day > 12 → dd/mm
    expect(parseDateToIso('03/25/2023')).toBe('2023-03-25'); // second > 12 → mm/dd
  });

  it('parses 2-digit years and yyyy/mm/dd', () => {
    expect(parseDateToIso('05/06/23')).toBe('2023-06-05');
    expect(parseDateToIso('2023/03/12')).toBe('2023-03-12');
  });

  it('parses month-name forms', () => {
    expect(parseDateToIso('12 Mar 2023')).toBe('2023-03-12');
    expect(parseDateToIso('March 12, 2023')).toBe('2023-03-12');
    expect(parseDateToIso('Mar 12 2023')).toBe('2023-03-12');
  });

  it('rejects invalid dates', () => {
    expect(parseDateToIso('2023-13-01')).toBeNull();
    expect(parseDateToIso('32/01/2023')).toBeNull();
    expect(parseDateToIso('not-a-date')).toBeNull();
    expect(parseDateToIso('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Enum synonym normalization
// ---------------------------------------------------------------------------

describe('normalizePolicyType', () => {
  it('maps synonyms to canonical enum values', () => {
    expect(normalizePolicyType('Health Insurance')).toBe('health');
    expect(normalizePolicyType('Two Wheeler')).toBe('motor');
    expect(normalizePolicyType('bike')).toBe('motor');
    expect(normalizePolicyType('car')).toBe('motor');
    expect(normalizePolicyType('term')).toBe('life');
    expect(normalizePolicyType('Travel')).toBe('travel');
    expect(normalizePolicyType('House')).toBe('home');
  });

  it('lowercases unknown values so the schema can reject them', () => {
    expect(normalizePolicyType('Spaceship')).toBe('spaceship');
  });
});

describe('normalizePaymentFrequency', () => {
  it('maps synonyms to canonical enum values', () => {
    expect(normalizePaymentFrequency('annual')).toBe('yearly');
    expect(normalizePaymentFrequency('Yearly')).toBe('yearly');
    expect(normalizePaymentFrequency('Half Yearly')).toBe('half_yearly');
    expect(normalizePaymentFrequency('semi-annual')).toBe('half_yearly');
    expect(normalizePaymentFrequency('Monthly')).toBe('monthly');
    expect(normalizePaymentFrequency('Quarterly')).toBe('quarterly');
  });
});

describe('normalizeStatus', () => {
  it('defaults blank to active and maps synonyms', () => {
    expect(normalizeStatus('')).toBe('active');
    expect(normalizeStatus(undefined)).toBe('active');
    expect(normalizeStatus('Pending')).toBe('pending_renewal');
    expect(normalizeStatus('canceled')).toBe('cancelled');
    expect(normalizeStatus('Expired')).toBe('expired');
  });
});

describe('normalizePhone', () => {
  it('keeps digits, + and spaces only', () => {
    // Dashes/parens are stripped; existing spaces are preserved and collapsed.
    expect(normalizePhone('+91-98200-11111')).toBe('+919820011111');
    expect(normalizePhone('+91 98200 11111')).toBe('+91 98200 11111');
    expect(normalizePhone('(022) 1234 5678')).toBe('022 1234 5678');
  });
});

// ---------------------------------------------------------------------------
// Header alias mapping
// ---------------------------------------------------------------------------

describe('mapHeaders', () => {
  it('maps common client header aliases', () => {
    expect(mapHeaders(['Client Name', 'E-mail', 'Mobile'], 'clients')).toEqual([
      'fullName',
      'email',
      'phone',
    ]);
  });

  it('maps common policy header aliases', () => {
    expect(
      mapHeaders(['Type', 'Premium', 'Sum Insured', 'Start', 'Expiry', 'Frequency'], 'policies'),
    ).toEqual(['policyType', 'premiumAmount', 'sumInsured', 'startDate', 'endDate', 'paymentFrequency']);
  });

  it('returns null for unrecognized headers', () => {
    expect(mapHeaders(['Nonsense'], 'clients')).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// Deterministic normalization → candidate
// ---------------------------------------------------------------------------

describe('normalizeClientCandidate', () => {
  it('trims and lowercases the email', () => {
    const candidate = normalizeClientCandidate({
      fullName: '  Ravi Kumar ',
      email: '  Ravi.Kumar@Example.COM ',
      phone: '+91 98200 11111',
    });
    expect(candidate).toEqual({
      fullName: 'Ravi Kumar',
      email: 'ravi.kumar@example.com',
      phone: '+91 98200 11111',
    });
  });
});

describe('normalizePolicyCandidate', () => {
  it('normalizes amounts, dates, enums, and applies optional defaults', () => {
    const candidate = normalizePolicyCandidate({
      clientEmail: 'Ravi@Example.com',
      policyType: 'Health Insurance',
      insurer: ' Star Health ',
      startDate: '01/01/2024',
      endDate: '01 Jan 2025',
      premiumAmount: '₹18,000',
      paymentFrequency: 'annual',
    });
    expect(candidate).toMatchObject({
      clientEmail: 'ravi@example.com',
      policyType: 'health',
      insurer: 'Star Health',
      startDate: '2024-01-01',
      endDate: '2025-01-01',
      premiumAmount: 18000,
      paymentFrequency: 'yearly',
      sumInsured: 0, // optional → 0
      deductible: 0, // optional → 0
      status: 'active', // default
    });
  });
});

// ---------------------------------------------------------------------------
// Strict validators — the safety boundary
// ---------------------------------------------------------------------------

describe('validateClient (strict schema)', () => {
  it('accepts a well-formed client and lowercases the email', () => {
    const outcome = validateClient({
      fullName: 'Ravi Kumar',
      email: 'Ravi@Example.com',
      phone: '+91 98200 11111',
    });
    expect(outcome.success).toBe(true);
    expect(outcome.data?.email).toBe('ravi@example.com');
  });

  it('rejects a missing email', () => {
    const outcome = validateClient({ fullName: 'Ravi', phone: '123' });
    expect(outcome.success).toBe(false);
    expect(outcome.errors.join(' ')).toContain('email');
  });

  it('rejects an invalid email', () => {
    const outcome = validateClient({ fullName: 'Ravi', email: 'not-an-email', phone: '123' });
    expect(outcome.success).toBe(false);
  });

  it('rejects an empty full name', () => {
    const outcome = validateClient({ fullName: '   ', email: 'a@b.com', phone: '123' });
    expect(outcome.success).toBe(false);
  });
});

describe('validatePolicy (strict schema)', () => {
  const known = new Set(['ravi@example.com']);
  const base = {
    clientEmail: 'ravi@example.com',
    policyType: 'health',
    insurer: 'Star Health',
    startDate: '2024-01-01',
    endDate: '2025-01-01',
    premiumAmount: 18000,
    paymentFrequency: 'yearly',
    sumInsured: 500000,
    deductible: 10000,
    status: 'active',
  };

  it('accepts a well-formed policy for an existing client', () => {
    expect(validatePolicy(base, known).success).toBe(true);
  });

  it('rejects when endDate is before startDate', () => {
    const outcome = validatePolicy({ ...base, startDate: '2025-01-01', endDate: '2024-01-01' }, known);
    expect(outcome.success).toBe(false);
    expect(outcome.errors.join(' ')).toContain('endDate');
  });

  it('rejects a non-positive premium', () => {
    expect(validatePolicy({ ...base, premiumAmount: 0 }, known).success).toBe(false);
    expect(validatePolicy({ ...base, premiumAmount: -100 }, known).success).toBe(false);
  });

  it('rejects a bad policyType enum', () => {
    expect(validatePolicy({ ...base, policyType: 'spaceship' }, known).success).toBe(false);
  });

  it('rejects a bad paymentFrequency enum', () => {
    expect(validatePolicy({ ...base, paymentFrequency: 'fortnightly' }, known).success).toBe(false);
  });

  it('rejects when the clientEmail does not resolve to an existing client', () => {
    const outcome = validatePolicy({ ...base, clientEmail: 'ghost@example.com' }, known);
    expect(outcome.success).toBe(false);
    expect(outcome.errors.join(' ')).toContain('no existing client');
  });

  it('defaults optional sumInsured/deductible to 0 and status to active', () => {
    const outcome = validatePolicy(
      {
        clientEmail: 'ravi@example.com',
        policyType: 'life',
        insurer: 'LIC',
        startDate: '2024-01-01',
        endDate: '2034-01-01',
        premiumAmount: 5000,
        paymentFrequency: 'monthly',
      },
      known,
    );
    expect(outcome.success).toBe(true);
    expect(outcome.data?.sumInsured).toBe(0);
    expect(outcome.data?.deductible).toBe(0);
    expect(outcome.data?.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Commit-time safety: the validator must reject deliberately bad objects.
// ---------------------------------------------------------------------------

describe('commit validator rejects bad rows (safety guarantee)', () => {
  it('rejects a deliberately bad client object at commit time', () => {
    const bad = { fullName: '', email: 'nope', phone: '' };
    const outcome = validateClient(bad);
    expect(outcome.success).toBe(false);
    expect(outcome.data).toBeNull();
    expect(outcome.errors.length).toBeGreaterThan(0);
  });

  it('rejects a deliberately bad policy object at commit time', () => {
    const bad = {
      clientEmail: 'ravi@example.com',
      policyType: 'health',
      insurer: 'Star',
      startDate: '2025-01-01',
      endDate: '2024-01-01', // before start
      premiumAmount: -50, // negative
      paymentFrequency: 'weekly', // bad enum
    };
    const outcome = validatePolicy(bad, new Set(['ravi@example.com']));
    expect(outcome.success).toBe(false);
    expect(outcome.data).toBeNull();
  });

  it('rejects entirely unexpected shapes', () => {
    expect(validateClient(null).success).toBe(false);
    expect(validateClient(42).success).toBe(false);
    expect(validatePolicy('oops', new Set()).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Templates + AI JSON extraction
// ---------------------------------------------------------------------------

describe('buildTemplateCsv', () => {
  it('produces a header row + one example row that round-trips through parseCsv', () => {
    const csv = buildTemplateCsv('clients');
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['fullName', 'email', 'phone']);
    expect(parsed.rows).toHaveLength(1);
  });

  it('produces the full policy header set', () => {
    const parsed = parseCsv(buildTemplateCsv('policies'));
    expect(parsed.headers).toContain('clientEmail');
    expect(parsed.headers).toContain('premiumAmount');
    expect(parsed.headers).toContain('status');
    expect(parsed.rows).toHaveLength(1);
  });
});

describe('extractJsonObject', () => {
  it('extracts the first balanced JSON object from noisy text', () => {
    const text = 'Sure! Here is the corrected row: {"fullName":"A","email":"a@b.com"} — done.';
    expect(extractJsonObject(text)).toEqual({ fullName: 'A', email: 'a@b.com' });
  });

  it('returns null when no JSON object is present', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });
});
