import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PolicyCard, type VaultPolicy } from './PolicyCard';

/**
 * Tests for the vault policy card (R6 health score + category, R6.4 download,
 * R6.5 delete).
 */
const policy: VaultPolicy = {
  id: 'p1',
  category: 'health',
  title: 'Family Floater',
  provider: 'Acme Health',
  premiumAmount: 12000,
  premiumCurrency: 'INR',
  sumInsured: 1000000,
  familyMemberId: null,
  originalFilename: 'policy.pdf',
  status: 'analyzed',
  healthScore: 82,
  riskFlagCount: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function renderCard(overrides: Partial<VaultPolicy> = {}, handlers = {}) {
  const onDownload = vi.fn();
  const onDelete = vi.fn();
  render(
    <MemoryRouter>
      <PolicyCard
        policy={{ ...policy, ...overrides }}
        onDownload={onDownload}
        onDelete={onDelete}
        {...handlers}
      />
    </MemoryRouter>,
  );
  return { onDownload, onDelete };
}

describe('PolicyCard', () => {
  it('shows the health score and category (R6)', () => {
    renderCard();
    expect(screen.getByText('82')).not.toBeNull();
    expect(screen.getByText('Health')).not.toBeNull();
  });

  it('shows an analyzing state when no health score is available', () => {
    renderCard({ healthScore: null, status: 'processing' });
    expect(screen.getByText('Analyzing…')).not.toBeNull();
  });

  it('fires onDownload and onDelete from the action buttons (R6.4/R6.5)', () => {
    const { onDownload, onDelete } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
