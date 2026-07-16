// Unit tests for the pure broker policy logic (R11).

import { describe, expect, it } from 'vitest';

import {
  classifyRenewal,
  computePremiumTracker,
  derivePolicyStatus,
  isEndBeforeStart,
  normalizeReminderWindow,
  pageBounds,
  planRenewalReminders,
  toCollectionStatus,
  totalPages,
  validateNewPolicy,
  validatePolicyEdit,
  type PolicyCoreFields,
  type ReminderCandidate,
} from './brokerPolicyLogic';

const NOW = new Date('2024-06-15T12:00:00.000Z');

/** ISO date `days` from NOW. */
function isoInDays(days: number): string {
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('derivePolicyStatus (R11.1)', () => {
  it('returns Cancelled regardless of dates', () => {
    expect(derivePolicyStatus({ status: 'cancelled', endDate: isoInDays(200) }, NOW)).toBe('Cancelled');
  });

  it('returns Expired when the end date has passed', () => {
    expect(derivePolicyStatus({ status: 'active', endDate: isoInDays(-1) }, NOW)).toBe('Expired');
  });

  it('returns Pending Renewal when ending within 30 days', () => {
    expect(derivePolicyStatus({ status: 'active', endDate: isoInDays(10) }, NOW)).toBe('Pending Renewal');
    expect(derivePolicyStatus({ status: 'active', endDate: isoInDays(30) }, NOW)).toBe('Pending Renewal');
  });

  it('returns Active when ending beyond 30 days', () => {
    expect(derivePolicyStatus({ status: 'active', endDate: isoInDays(31) }, NOW)).toBe('Active');
  });

  it('falls back to stored status when no end date', () => {
    expect(derivePolicyStatus({ status: 'expired', endDate: null }, NOW)).toBe('Expired');
    expect(derivePolicyStatus({ status: 'pending_renewal', endDate: null }, NOW)).toBe('Pending Renewal');
    expect(derivePolicyStatus({ status: 'active', endDate: null }, NOW)).toBe('Active');
  });
});

describe('validateNewPolicy (R11.1/R11.6)', () => {
  const validBody = {
    clientId: 'c1',
    policyType: 'health',
    insurer: 'Acme',
    startDate: '2024-01-01',
    endDate: '2025-01-01',
    premiumAmount: 1200,
    paymentFrequency: 'annual',
  };

  it('accepts a complete policy', () => {
    const result = validateNewPolicy(validBody);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.endDateBeforeStart).toBe(false);
  });

  it('names every missing required field', () => {
    const result = validateNewPolicy({});
    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual([
      'clientId',
      'policyType',
      'insurer',
      'startDate',
      'endDate',
      'premiumAmount',
      'paymentFrequency',
    ]);
  });

  it('rejects a non-numeric premium amount', () => {
    const result = validateNewPolicy({ ...validBody, premiumAmount: 'abc' });
    expect(result.missingFields).toContain('premiumAmount');
  });

  it('flags an end date before the start date (R11.6)', () => {
    const result = validateNewPolicy({ ...validBody, startDate: '2025-01-01', endDate: '2024-01-01' });
    expect(result.valid).toBe(false);
    expect(result.endDateBeforeStart).toBe(true);
  });

  it('isEndBeforeStart is false when equal', () => {
    expect(isEndBeforeStart('2024-01-01', '2024-01-01')).toBe(false);
  });
});

describe('validatePolicyEdit (R11.1/R11.6)', () => {
  const current: PolicyCoreFields = {
    clientId: 'c1',
    policyType: 'health',
    insurer: 'Acme',
    startDate: '2024-01-01',
    endDate: '2025-01-01',
    premiumAmount: 1200,
    paymentFrequency: 'annual',
  };

  it('validates against the merged record', () => {
    expect(validatePolicyEdit(current, { insurer: 'NewCo' }).valid).toBe(true);
  });

  it('rejects clearing a required field', () => {
    const result = validatePolicyEdit(current, { insurer: '' });
    expect(result.missingFields).toContain('insurer');
  });

  it('flags end-before-start after patching the end date', () => {
    const result = validatePolicyEdit(current, { endDate: '2023-01-01' });
    expect(result.endDateBeforeStart).toBe(true);
  });
});

describe('pagination (R11.1)', () => {
  it('caps page size at 50 and computes DB range', () => {
    const bounds = pageBounds(1);
    expect(bounds.pageSize).toBe(50);
    expect(bounds.from).toBe(0);
    expect(bounds.to).toBe(49);
  });

  it('offsets by page', () => {
    const bounds = pageBounds(3);
    expect(bounds.from).toBe(100);
    expect(bounds.to).toBe(149);
  });

  it('clamps invalid pages to 1', () => {
    expect(pageBounds(0).page).toBe(1);
    expect(pageBounds(-4).page).toBe(1);
    expect(pageBounds('foo').page).toBe(1);
  });

  it('computes total pages', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(50)).toBe(1);
    expect(totalPages(51)).toBe(2);
    expect(totalPages(120)).toBe(3);
  });
});

describe('classifyRenewal (R11.2/R11.3)', () => {
  it('marks renewals within 30 days as due soon', () => {
    const c = classifyRenewal(isoInDays(20), NOW);
    expect(c.withinWindow).toBe(true);
    expect(c.dueSoon).toBe(true);
  });

  it('includes renewals within 90 days but not due soon beyond 30', () => {
    const c = classifyRenewal(isoInDays(60), NOW);
    expect(c.withinWindow).toBe(true);
    expect(c.dueSoon).toBe(false);
  });

  it('excludes renewals beyond 90 days', () => {
    expect(classifyRenewal(isoInDays(120), NOW).withinWindow).toBe(false);
  });

  it('excludes past renewals', () => {
    expect(classifyRenewal(isoInDays(-1), NOW).withinWindow).toBe(false);
  });
});

describe('renewal reminders (R11.5/R11.7)', () => {
  const candidates: ReminderCandidate[] = [
    { renewalId: 'r1', clientId: 'c1', clientName: 'Alice', contact: 'a@x.com', renewalDate: isoInDays(5) },
    { renewalId: 'r2', clientId: 'c2', clientName: 'Bob', contact: null, renewalDate: isoInDays(10) },
    { renewalId: 'r3', clientId: 'c3', clientName: 'Carol', contact: 'c@x.com', renewalDate: isoInDays(60) },
  ];

  it('sends to in-window recipients with contact info', () => {
    const plan = planRenewalReminders(candidates, 30, NOW);
    expect(plan.sentRenewalIds).toEqual(['r1']);
    expect(plan.sentCount).toBe(1);
  });

  it('reports failed recipients missing contact info (R11.7)', () => {
    const plan = planRenewalReminders(candidates, 30, NOW);
    expect(plan.failed).toHaveLength(1);
    expect(plan.failed[0]?.clientId).toBe('c2');
  });

  it('respects a wider window', () => {
    const plan = planRenewalReminders(candidates, 90, NOW);
    expect(plan.sentRenewalIds).toEqual(['r1', 'r3']);
  });

  it('normalizes the reminder window', () => {
    expect(normalizeReminderWindow(undefined)).toBe(30);
    expect(normalizeReminderWindow(0)).toBe(30);
    expect(normalizeReminderWindow(45)).toBe(45);
    expect(normalizeReminderWindow(500)).toBe(90);
  });
});

describe('premium tracker (R11.4)', () => {
  it('maps display status to a collection bucket', () => {
    expect(toCollectionStatus('Active')).toBe('Paid');
    expect(toCollectionStatus('Pending Renewal')).toBe('Pending');
    expect(toCollectionStatus('Expired')).toBe('Overdue');
    expect(toCollectionStatus('Cancelled')).toBeNull();
  });

  it('aggregates collection status and a 12-month chart by type', () => {
    const tracker = computePremiumTracker(
      [
        { policyType: 'health', premiumAmount: 1000, status: 'active', startDate: isoInDays(-5), endDate: isoInDays(300) },
        { policyType: 'motor', premiumAmount: 500, status: 'active', startDate: isoInDays(-5), endDate: isoInDays(10) },
        { policyType: 'life', premiumAmount: 200, status: 'active', startDate: isoInDays(-5), endDate: isoInDays(-1) },
        { policyType: 'home', premiumAmount: 999, status: 'cancelled', startDate: isoInDays(-5), endDate: isoInDays(300) },
      ],
      NOW,
    );

    expect(tracker.collection.paid.count).toBe(1);
    expect(tracker.collection.pending.count).toBe(1);
    expect(tracker.collection.overdue.count).toBe(1);
    expect(tracker.months).toHaveLength(12);
    expect(tracker.types).toEqual(['health', 'life', 'motor']); // cancelled excluded from collection but still charted
    expect(tracker.empty).toBe(false);
  });

  it('reports an empty state when there is no data', () => {
    const tracker = computePremiumTracker([], NOW);
    expect(tracker.empty).toBe(true);
    expect(tracker.months).toHaveLength(12);
  });
});
