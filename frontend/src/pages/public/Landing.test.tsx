import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from './Landing';

/**
 * Landing page acceptance-criteria tests (R20).
 *
 * The page renders inside a router because it uses react-router <Link>s for
 * the primary CTA (→ /try) and the log-in link (→ /login). Each test asserts
 * one of the R20 acceptance criteria so the marketing content stays traceable.
 */
function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe('Landing (R20)', () => {
  it('shows the hero headline (R20.1)', () => {
    renderLanding();
    expect(
      screen.getByText(/Know exactly what your insurance/i),
    ).not.toBeNull();
    expect(screen.getByText(/actually covers\./i)).not.toBeNull();
  });

  it('shows the four-step process Upload → Extract → Analyze → Decide (R20.2)', () => {
    renderLanding();
    for (const step of ['Upload', 'Extract', 'Analyze', 'Decide']) {
      expect(screen.getByRole('heading', { name: step })).not.toBeNull();
    }
  });

  it('shows the four coverage types and scanned/typed PDF support (R20.3)', () => {
    renderLanding();
    for (const type of ['Health', 'Motor', 'Life', 'Travel']) {
      // Coverage names appear as headings in the coverage grid.
      expect(screen.getAllByText(type).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Scanned & typed PDFs/i)).not.toBeNull();
  });

  it('shows the no-account preview message (R20.4)', () => {
    renderLanding();
    expect(
      screen.getAllByText(/No account needed to preview · Results in under 40 seconds/i)
        .length,
    ).toBeGreaterThan(0);
  });

  it('renders footer sections Product, Coverage Types, and Company (R20.6)', () => {
    renderLanding();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('Product')).not.toBeNull();
    expect(within(footer).getByText('Coverage Types')).not.toBeNull();
    expect(within(footer).getByText('Company')).not.toBeNull();
    expect(
      within(footer).getByText('Not a substitute for professional insurance advice.'),
    ).not.toBeNull();
  });

  it('wires the primary CTA to the no-account /try preview flow (R20.7)', () => {
    renderLanding();
    const ctas = screen.getAllByRole('link', { name: /Analyze my policy/i });
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      expect(cta.getAttribute('href')).toBe('/try');
    }
  });
});
