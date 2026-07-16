// Unit tests for the broker dashboard aggregation helpers (R9.1–R9.3, R9.6).
//
// These cover the pure aggregation logic in isolation (no Supabase): KPI
// derivation, the trailing-12-month premium chart with per-type breakdown +
// empty state, and commission classification (paid / pending / derived-overdue)
// with 2-decimal rounding.

import { describe, expect, it } from 'vitest';

import {
  computeCommissionOverview,
  computeKpis,
  computePremiumCollection,
  round2,
} from '../src/services/broker/brokerDashboardService';

// Fixed reference "now" so time windows are deterministic: 2024-06-15 (UTC).
const NOW = new Date('2024-06-15T12:00:00.000Z');

describe('round2', () => {
  it('rounds to 2 decimals and normalizes negative zero', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.344)).toBe(2.34);
    expect(round2(-0)).toBe(0);
    expect(round2(100)).toBe(100);
  });
});

describe('computeKpis', () => {
  it('aggregates counts and YTD premium', () => {
    const kpis = computeKpis(
      [
        { id: 'p1', policy_type: 'health', premium_amount: 1000, status: 'active', start_date: '2024-02-01' },
        { id: 'p2', policy_type: 'motor', premium_amount: '500.5', status: 'active', start_date: '2024-05-10' },
        // Prior-year policy — excluded from YTD but still counts as active.
        { id: 'p3', policy_type: 'life', premium_amount: 9999, status: 'active', start_date: '2023-12-01' },
        // Non-active status.
        { id: 'p4', policy_type: 'travel', premium_amount: 200, status: 'expired', start_date: '2024-03-01' },
      ],
      3, // clientCount
      [
        { renewal_date: '2024-06-20' }, // within 30 days
        { renewal_date: '2024-07-10' }, // within 30 days
        { renewal_date: '2024-08-01' }, // beyond 30 days
        { renewal_date: '2024-01-01' }, // in the past
      ],
      [
        { status: 'pending' },
        { status: 'under_review' },
        { status: 'approved' },
        { status: 'rejected' },
      ],
      NOW,
    );

    expect(kpis.totalPremiumYtd).toBe(1700.5); // p1 + p2 + p4 (this-year starts)
    expect(kpis.activePolicies).toBe(3); // p1, p2, p3
    expect(kpis.totalClients).toBe(3);
    expect(kpis.renewalsDue).toBe(2);
    expect(kpis.pendingClaims).toBe(2);
  });

  it('returns all zeros for an empty broker (R9.6)', () => {
    const kpis = computeKpis([], 0, [], [], NOW);
    expect(kpis).toEqual({
      totalPremiumYtd: 0,
      activePolicies: 0,
      totalClients: 0,
      renewalsDue: 0,
      pendingClaims: 0,
    });
  });
});

describe('computePremiumCollection', () => {
  it('produces 12 trailing month buckets ending with the current month', () => {
    const result = computePremiumCollection([], NOW);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]?.month).toBe('2023-07');
    expect(result.months[11]?.month).toBe('2024-06');
    expect(result.empty).toBe(true);
    expect(result.types).toEqual([]);
  });

  it('buckets premium by month and insurance type', () => {
    const result = computePremiumCollection(
      [
        { id: 'a', policy_type: 'health', premium_amount: 100, status: 'active', start_date: '2024-06-05' },
        { id: 'b', policy_type: 'health', premium_amount: 50, status: 'active', start_date: '2024-06-20' },
        { id: 'c', policy_type: 'motor', premium_amount: 200, status: 'active', start_date: '2024-05-01' },
        // Outside the window — ignored.
        { id: 'd', policy_type: 'life', premium_amount: 999, status: 'active', start_date: '2022-01-01' },
      ],
      NOW,
    );

    expect(result.empty).toBe(false);
    expect(result.types).toEqual(['health', 'motor']);

    const june = result.months.find((m) => m.month === '2024-06');
    expect(june?.total).toBe(150);
    expect(june?.byType).toEqual({ health: 150 });

    const may = result.months.find((m) => m.month === '2024-05');
    expect(may?.total).toBe(200);
    expect(may?.byType).toEqual({ motor: 200 });
  });
});

describe('computeCommissionOverview', () => {
  it('classifies paid, pending, and derived-overdue amounts to 2 decimals', () => {
    const overview = computeCommissionOverview(
      [
        { amount: 100.5, status: 'paid', scheduled_date: '2024-01-01', paid_date: '2024-01-05' },
        // Unpaid, scheduled recently → pending.
        { amount: 200, status: 'pending', scheduled_date: '2024-06-10', paid_date: null },
        // Unpaid, scheduled > 30 days ago → derived overdue.
        { amount: 300.25, status: 'pending', scheduled_date: '2024-04-01', paid_date: null },
        // Explicitly flagged overdue.
        { amount: 50, status: 'overdue', scheduled_date: null, paid_date: null },
      ],
      'INR',
      NOW,
    );

    expect(overview.total).toBe(650.75);
    expect(overview.paid).toBe(100.5);
    expect(overview.pending).toBe(200);
    expect(overview.overdue).toBe(350.25);
    expect(overview.currency).toBe('INR');
  });

  it('returns zeros for no commissions (R9.6)', () => {
    const overview = computeCommissionOverview([], 'USD', NOW);
    expect(overview).toEqual({ total: 0, paid: 0, pending: 0, overdue: 0, currency: 'USD' });
  });
});
