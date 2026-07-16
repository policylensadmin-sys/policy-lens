import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskFlagCard } from './RiskFlagCard';

/**
 * Tests for the risk-flag summary card (R4.2 count, R4.5 no-flags state).
 */
describe('RiskFlagCard', () => {
  it('shows a distinct count when risk flags are present (R4.2)', () => {
    render(<RiskFlagCard count={3} />);
    expect(screen.getByText('3 risk flags found')).not.toBeNull();
  });

  it('uses singular wording for a single risk flag', () => {
    render(<RiskFlagCard count={1} />);
    expect(screen.getByText('1 risk flag found')).not.toBeNull();
  });

  it('shows a confirmation message when there are no risk flags (R4.5)', () => {
    render(<RiskFlagCard count={0} />);
    expect(screen.getByText('No risk flags found')).not.toBeNull();
  });
});
