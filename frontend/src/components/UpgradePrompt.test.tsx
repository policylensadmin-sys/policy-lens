import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UpgradePrompt } from './UpgradePrompt';

/**
 * Tests for the premium-gate prompt (R18.4 names the feature + links to upgrade).
 */
describe('UpgradePrompt', () => {
  it('names the restricted feature and links to the upgrade page (R18.4)', () => {
    render(
      <MemoryRouter>
        <UpgradePrompt feature="Policy Comparison" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Policy Comparison is a Premium feature')).not.toBeNull();
    const link = screen.getByRole('link', { name: /upgrade options/i });
    expect(link.getAttribute('href')).toBe('/app/upgrade');
  });
});
