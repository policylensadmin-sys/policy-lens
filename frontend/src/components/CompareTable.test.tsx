import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComparisonResult } from '@policylens/shared';
import { CompareTable } from './CompareTable';

/**
 * Tests for the A/B comparison table (R7.3 scores, R7.4 superior indicators).
 */
const result: ComparisonResult = {
  policyAId: 'a',
  policyBId: 'b',
  scoreA: 82,
  scoreB: 55,
  rows: [
    { label: 'Premium', valueA: '₹12,000', valueB: '₹9,000', superior: 'B' },
    { label: 'Sum insured', valueA: '₹10L', valueB: '₹5L', superior: 'A' },
    { label: 'Provider', valueA: 'Acme', valueB: 'Beta', superior: 'equal' },
  ],
  winner: 'A',
  recommendation: 'Policy A scores higher overall due to broader coverage.',
};

describe('CompareTable', () => {
  it('renders both 0–100 scores (R7.3)', () => {
    render(<CompareTable result={result} labelA="Acme" labelB="Beta" />);
    expect(screen.getByText('82')).not.toBeNull();
    expect(screen.getByText('55')).not.toBeNull();
  });

  it('marks the superior policy per row (R7.4)', () => {
    render(<CompareTable result={result} />);
    // Two rows have a superior side (Premium→B, Sum insured→A); the equal row has none.
    expect(screen.getAllByLabelText('superior')).toHaveLength(2);
  });

  it('shows the recommendation and winner label (R7.2)', () => {
    render(<CompareTable result={result} labelA="Acme" labelB="Beta" />);
    expect(screen.getByText(/Winner: Acme/)).not.toBeNull();
    expect(screen.getByText(/broader coverage/)).not.toBeNull();
  });
});
