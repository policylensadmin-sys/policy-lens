import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Recommendation } from '@policylens/shared';
import { RecommendationList } from './RecommendationList';

/**
 * Tests for the recommendation list (R4.4 up-to-5 with gap/risk labels,
 * R4.6 no-recommendations state).
 */
function rec(kind: Recommendation['kind'], n: number): Recommendation {
  return { kind, title: `Recommendation ${n}`, detail: `Detail ${n}` };
}

describe('RecommendationList', () => {
  it('labels recommendations as coverage gap or risk flag (R4.4)', () => {
    render(<RecommendationList recommendations={[rec('gap', 1), rec('risk', 2)]} />);
    expect(screen.getByText('Coverage gap')).not.toBeNull();
    expect(screen.getByText('Risk flag')).not.toBeNull();
  });

  it('shows at most 5 recommendations (R4.4)', () => {
    const many = Array.from({ length: 8 }, (_, i) => rec('gap', i + 1));
    render(<RecommendationList recommendations={many} />);
    expect(screen.queryByText('Recommendation 5')).not.toBeNull();
    expect(screen.queryByText('Recommendation 6')).toBeNull();
  });

  it('shows a no-improvement message when empty (R4.6)', () => {
    render(<RecommendationList recommendations={[]} />);
    expect(screen.getByText('This policy has no identified improvement areas.')).not.toBeNull();
  });
});
