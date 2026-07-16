import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ClaimResult } from '@policylens/shared';
import { ClaimChecklist } from './ClaimChecklist';

/**
 * Tests for the claim simulation result view (R8.3 probability/reasons,
 * R8.4 satisfied items, R8.5 matched exclusion).
 */
const baseResult: ClaimResult = {
  approvalProbability: 76,
  checks: [
    { label: 'Hospitalisation covered', status: 'ok' },
    { label: 'Waiting period satisfied', status: 'warn', detail: 'Close to the 90-day limit' },
  ],
  reasons: ['Room rent is within the sub-limit', 'No exclusion matched the scenario'],
  matchedExclusion: null,
};

describe('ClaimChecklist', () => {
  it('renders the approval probability as a percentage (R8.3)', () => {
    render(<ClaimChecklist result={baseResult} />);
    expect(screen.getByText('76%')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('76');
  });

  it('lists satisfied checks and reasons (R8.3/R8.4)', () => {
    render(<ClaimChecklist result={baseResult} />);
    expect(screen.getByText('Hospitalisation covered')).not.toBeNull();
    expect(screen.getByText(/Room rent is within the sub-limit/)).not.toBeNull();
  });

  it('names the matched exclusion when present (R8.5)', () => {
    render(
      <ClaimChecklist
        result={{ ...baseResult, matchedExclusion: 'Cosmetic procedures excluded' }}
      />,
    );
    expect(screen.getByText('Exclusion applies')).not.toBeNull();
    expect(screen.getByText('Cosmetic procedures excluded')).not.toBeNull();
  });
});
