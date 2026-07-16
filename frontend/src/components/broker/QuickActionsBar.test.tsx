import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickActionsBar } from './QuickActionsBar';

/**
 * Quick Actions bar (R14). Verifies the exact 8 actions render, that
 * unmet-prerequisite actions surface a message instead of navigating (R14.4),
 * and that unblocked actions navigate to their workflow (R14.2).
 */
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const ACTION_LABELS = [
  'Add Client',
  'Add Policy',
  'Compare Policies',
  'AI Policy Analysis',
  'Premium Calculator',
  'Generate Report',
  'Send Renewal Reminders',
  'Claim Assistant',
];

function renderBar(props: { activePolicies: number; renewalsDue: number }) {
  return render(
    <MemoryRouter>
      <QuickActionsBar {...props} />
    </MemoryRouter>,
  );
}

describe('QuickActionsBar', () => {
  it('renders exactly 8 quick actions in order (R14.1)', () => {
    renderBar({ activePolicies: 5, renewalsDue: 3 });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(8);
    // Icons are aria-hidden, so each button's accessible name is its label.
    for (const label of ACTION_LABELS) {
      expect(screen.queryByRole('button', { name: label })).not.toBeNull();
    }
  });

  it('lays out the 8 actions in a single row on ≥1024px viewports (R14.3)', () => {
    const { container } = renderBar({ activePolicies: 5, renewalsDue: 3 });
    // The grid switches to 8 columns at the lg breakpoint (≥1024px) so every
    // action is visible without scrolling.
    const grid = container.querySelector('.lg\\:grid-cols-8');
    expect(grid).not.toBeNull();
  });

  it('navigates directly when prerequisites are met (R14.2)', () => {
    mockNavigate.mockClear();
    renderBar({ activePolicies: 5, renewalsDue: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Compare Policies' }));
    expect(mockNavigate).toHaveBeenCalledWith('/broker/policies?action=compare');
  });

  it('shows a prerequisite message for Compare Policies with <2 policies (R14.4)', () => {
    mockNavigate.mockClear();
    renderBar({ activePolicies: 1, renewalsDue: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Compare Policies' }));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(
      /at least two policies/i,
    );
  });

  it('blocks Send Renewal Reminders when none are due (R14.4)', () => {
    mockNavigate.mockClear();
    renderBar({ activePolicies: 5, renewalsDue: 0 });

    fireEvent.click(
      screen.getByRole('button', { name: 'Send Renewal Reminders' }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/no renewals are due/i);
  });
});
