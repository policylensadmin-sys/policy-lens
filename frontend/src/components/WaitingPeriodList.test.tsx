import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WaitingPeriod } from '@policylens/shared';
import { WaitingPeriodList } from './WaitingPeriodList';

/**
 * Tests for waiting periods grouped by duration (R4.1).
 */
describe('WaitingPeriodList', () => {
  it('groups multiple conditions under a shared duration (R4.1)', () => {
    const periods: WaitingPeriod[] = [
      { duration: '2 years', appliesTo: 'Pre-existing diseases' },
      { duration: '2 years', appliesTo: 'Joint replacement' },
      { duration: '30 days', appliesTo: 'Initial waiting period' },
    ];
    render(<WaitingPeriodList waitingPeriods={periods} />);

    // Two distinct duration groups rendered.
    expect(screen.getByText('2 years')).not.toBeNull();
    expect(screen.getByText('30 days')).not.toBeNull();
    // Both conditions for the shared duration are listed.
    expect(screen.getByText('Pre-existing diseases')).not.toBeNull();
    expect(screen.getByText('Joint replacement')).not.toBeNull();
  });

  it('shows an empty message when there are no waiting periods (R3.9)', () => {
    render(<WaitingPeriodList waitingPeriods={[]} />);
    expect(screen.getByText('No waiting periods were identified in this policy.')).not.toBeNull();
  });
});
