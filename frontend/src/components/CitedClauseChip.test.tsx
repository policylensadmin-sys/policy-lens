import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CitedClauseChip, toMatchPercent } from './CitedClauseChip';

/**
 * Tests for the cited-clause chip (R5.2 — section label + match %).
 */
describe('CitedClauseChip', () => {
  it('renders the section label and match percentage (R5.2)', () => {
    render(<CitedClauseChip citation={{ section: '4.2', match: 0.94 }} />);
    expect(screen.getByText('4.2')).not.toBeNull();
    expect(screen.getByText('94% match')).not.toBeNull();
  });

  it('scales a 0–1 match into a whole-number percentage', () => {
    expect(toMatchPercent(0.5)).toBe(50);
    expect(toMatchPercent(1)).toBe(100);
    expect(toMatchPercent(0)).toBe(0);
  });

  it('clamps out-of-range and non-finite matches to [0, 100]', () => {
    expect(toMatchPercent(1.5)).toBe(100);
    expect(toMatchPercent(-0.3)).toBe(0);
    expect(toMatchPercent(Number.NaN)).toBe(0);
  });
});
