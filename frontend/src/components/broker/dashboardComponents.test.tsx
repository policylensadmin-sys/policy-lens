import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommissionBreakdown } from './CommissionBreakdown';
import { RiskDashboardStrip } from './RiskDashboardStrip';
import { AIInsightList } from './AIInsightList';
import { RenewalCalendar } from './RenewalCalendar';
import { formatMoney, formatMonthLabel, humanizeKey } from './types';
import type { RiskCounts } from './types';

const ZERO_RISK: RiskCounts = {
  underinsured: 0,
  missing_family_coverage: 0,
  high_deductible: 0,
  waiting_period_ending: 0,
  no_health_insurance: 0,
};

describe('broker dashboard helpers', () => {
  it('formats commission amounts to 2 decimal places (R9.3)', () => {
    // Uses INR so the grouping/symbol is deterministic across environments.
    expect(formatMoney(1234.5, 'INR')).toMatch(/1,234\.50/);
    expect(formatMoney(0, 'INR')).toMatch(/0\.00/);
  });

  it('humanizes snake_case keys', () => {
    expect(humanizeKey('renewal_optimization')).toBe('Renewal Optimization');
  });

  it('formats YYYY-MM month keys to short labels', () => {
    expect(formatMonthLabel('2024-01')).toMatch(/Jan/);
  });
});

describe('CommissionBreakdown', () => {
  it('renders total, paid, pending and overdue amounts (R9.3)', () => {
    render(
      <CommissionBreakdown
        commission={{
          total: 1000,
          paid: 600,
          pending: 300,
          overdue: 100,
          currency: 'INR',
        }}
      />,
    );
    expect(screen.queryByText('Paid')).not.toBeNull();
    expect(screen.queryByText('Pending')).not.toBeNull();
    expect(screen.queryByText('Overdue')).not.toBeNull();
    expect(screen.queryByText(/1,000\.00/)).not.toBeNull();
  });
});

describe('RiskDashboardStrip', () => {
  it('renders all five risk categories (R10.3)', () => {
    render(
      <MemoryRouter>
        <RiskDashboardStrip counts={{ ...ZERO_RISK, underinsured: 3 }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Underinsured')).not.toBeNull();
    expect(screen.queryByText('Missing family coverage')).not.toBeNull();
    expect(screen.queryByText('High deductible')).not.toBeNull();
    expect(screen.queryByText('Waiting period ending')).not.toBeNull();
    expect(screen.queryByText('No health insurance')).not.toBeNull();
    expect(screen.queryByText('3')).not.toBeNull();
  });
});

describe('AIInsightList', () => {
  it('shows insight messages with category and affected-client count (R13.4)', () => {
    render(
      <MemoryRouter>
        <AIInsightList
          insights={[
            {
              id: 'i1',
              type: 'upsell',
              message: '12 clients can benefit from higher health cover',
              clientIds: ['c1', 'c2'],
              generatedAt: '2024-06-15T10:00:00.000Z',
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/higher health cover/i)).not.toBeNull();
    expect(screen.queryByText(/2 affected clients/i)).not.toBeNull();
  });

  it('shows an unavailable state when there are no insights (R13.5)', () => {
    render(
      <MemoryRouter>
        <AIInsightList insights={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/temporarily unavailable/i)).not.toBeNull();
  });
});

describe('RenewalCalendar', () => {
  it('flags entries due within 30 days with a distinct indicator (R11.3)', () => {
    render(
      <MemoryRouter>
        <RenewalCalendar
          currency="INR"
          entries={[
            {
              renewalId: 'r1',
              policyId: 'p1',
              clientId: 'c1',
              clientName: 'Acme Corp',
              policyType: 'health',
              insurer: 'HDFC',
              renewalDate: '2024-07-01T00:00:00.000Z',
              premiumAmount: 5000,
              daysUntil: 12,
              dueSoon: true,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Acme Corp')).not.toBeNull();
    expect(screen.queryByText(/due soon/i)).not.toBeNull();
  });

  it('renders an empty state when there are no renewals', () => {
    render(
      <MemoryRouter>
        <RenewalCalendar currency="INR" entries={[]} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByText(/no renewals due in the next 90 days/i),
    ).not.toBeNull();
  });
});
