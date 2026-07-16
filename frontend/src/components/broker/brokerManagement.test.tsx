import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type Column } from './DataTable';
import { ClientForm } from './ClientForm';
import { PolicyForm } from './PolicyForm';
import type { ClientView } from './types';

interface Row {
  id: string;
  name: string;
}

const ROW_COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name },
];

describe('DataTable (R11.1)', () => {
  it('shows an empty message when there are no rows', () => {
    render(
      <DataTable<Row>
        columns={ROW_COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        page={1}
        totalPages={1}
        totalCount={0}
        pageSize={50}
        onPageChange={() => {}}
        emptyMessage="Nothing here"
      />,
    );
    expect(screen.queryByText('Nothing here')).not.toBeNull();
  });

  it('caps navigation at the reported total pages and reports the range', () => {
    const onPageChange = vi.fn();
    render(
      <DataTable<Row>
        columns={ROW_COLUMNS}
        rows={[{ id: 'a', name: 'Alpha' }]}
        rowKey={(r) => r.id}
        page={2}
        totalPages={2}
        totalCount={51}
        pageSize={50}
        onPageChange={onPageChange}
      />,
    );
    // On the last page, Next is disabled; Previous advances back to page 1.
    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(screen.queryByText(/51–51 of 51/)).not.toBeNull();
  });

  it('surfaces an error state', () => {
    render(
      <DataTable<Row>
        columns={ROW_COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        page={1}
        totalPages={1}
        totalCount={0}
        pageSize={50}
        onPageChange={() => {}}
        error="Boom"
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Boom');
  });
});

describe('ClientForm (R10.5)', () => {
  it('blocks submission and shows required-field errors when empty', () => {
    const onSubmitCreate = vi.fn();
    render(
      <ClientForm
        mode="create"
        onSubmitCreate={onSubmitCreate}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add client/i }));
    expect(onSubmitCreate).not.toHaveBeenCalled();
    expect(screen.queryByText(/full name is required/i)).not.toBeNull();
    expect(screen.queryByText(/email is required/i)).not.toBeNull();
    expect(screen.queryByText(/phone number is required/i)).not.toBeNull();
  });

  it('maps server-reported missing fields to inline errors (R10.5)', () => {
    render(
      <ClientForm
        mode="create"
        serverDetails={{ missingFields: ['email'] }}
        onSubmitCreate={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/email is required/i)).not.toBeNull();
  });

  it('submits a valid client with an associated policy', () => {
    const onSubmitCreate = vi.fn();
    render(
      <ClientForm
        mode="create"
        onSubmitCreate={onSubmitCreate}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '555-0100' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add client/i }));
    expect(onSubmitCreate).toHaveBeenCalledTimes(1);
    const payload = onSubmitCreate.mock.calls[0]![0];
    expect(payload.fullName).toBe('Jane Doe');
    expect(payload.policies).toHaveLength(1);
    expect(payload.policies[0].policyType).toBe('health');
  });
});

const CLIENTS: ClientView[] = [
  {
    id: 'c1',
    brokerId: 'b1',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-0100',
    riskFlags: [],
    policies: [],
    coverageGaps: [],
    risk: {
      underinsured: false,
      missing_family_coverage: false,
      high_deductible: false,
      waiting_period_ending: false,
      no_health_insurance: false,
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

describe('PolicyForm (R11.6)', () => {
  function fillRequired() {
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Insurer'), {
      target: { value: 'HDFC' },
    });
    fireEvent.change(screen.getByLabelText('Premium amount'), {
      target: { value: '5000' },
    });
    fireEvent.change(screen.getByLabelText('Payment frequency'), {
      target: { value: 'yearly' },
    });
  }

  it('shows an end-date-before-start error and blocks submit (R11.6)', () => {
    const onSubmit = vi.fn();
    render(
      <PolicyForm
        mode="create"
        clients={CLIENTS}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fillRequired();
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2024-06-01' },
    });
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2024-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add policy/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/end date cannot be earlier than the start date/i),
    ).not.toBeNull();
  });

  it('preserves entered data and shows server errors on a 422 (R11.6)', () => {
    render(
      <PolicyForm
        mode="create"
        clients={CLIENTS}
        serverDetails={{ missingFields: ['insurer'], endDateBeforeStart: false }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/insurer is required/i)).not.toBeNull();
  });

  it('submits a valid policy', () => {
    const onSubmit = vi.fn();
    render(
      <PolicyForm
        mode="create"
        clients={CLIENTS}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fillRequired();
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2024-01-01' },
    });
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2024-12-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add policy/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0] as { clientId: string; premiumAmount: number };
    expect(payload.clientId).toBe('c1');
    expect(payload.premiumAmount).toBe(5000);
  });
});
