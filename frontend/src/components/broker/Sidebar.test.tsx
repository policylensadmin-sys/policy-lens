import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar, BROKER_NAV_SECTIONS } from './Sidebar';

/**
 * Sidebar navigation (R19.1, R19.2) — verifies all 14 sections render as links
 * and the active section is highlighted.
 */
const SECTION_LABELS = [
  'Dashboard',
  'Clients',
  'Policies',
  'Renewals',
  'Premiums',
  'Commission',
  'Claims',
  'Leads',
  'AI Assistant',
  'Reports',
  'Analytics',
  'Documents',
  'Team',
  'Settings',
];

describe('Sidebar', () => {
  it('lists exactly the 14 required broker sections (R19.1)', () => {
    expect(BROKER_NAV_SECTIONS).toHaveLength(14);
    expect(BROKER_NAV_SECTIONS.map((s) => s.label)).toEqual(SECTION_LABELS);
  });

  it('renders all 14 sections as navigation links', () => {
    render(
      <MemoryRouter initialEntries={['/broker/dashboard']}>
        <Sidebar />
      </MemoryRouter>,
    );
    for (const label of SECTION_LABELS) {
      expect(screen.queryByRole('link', { name: label })).not.toBeNull();
    }
  });

  it('highlights the active section via aria-current (R19.2)', () => {
    render(
      <MemoryRouter initialEntries={['/broker/clients']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const active = screen.getByRole('link', { name: 'Clients' });
    expect(active.getAttribute('aria-current')).toBe('page');
    // A non-active link should not be marked current.
    const inactive = screen.getByRole('link', { name: 'Policies' });
    expect(inactive.getAttribute('aria-current')).not.toBe('page');
  });
});
