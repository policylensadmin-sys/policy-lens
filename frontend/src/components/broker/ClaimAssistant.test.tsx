import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClaimAssistant, missingRequiredFields } from './ClaimAssistant';
import type { BrokerPolicyView } from './types';

/**
 * Claim Assistant (R12.4/R12.5). Verifies the sequential workflow advances only
 * once the current step's required field is present, and that submission is
 * prevented while required information is missing.
 */

const POLICIES: BrokerPolicyView[] = [
  {
    id: 'pol-1',
    clientId: 'cli-1',
    clientName: 'Asha Rao',
    policyType: 'health',
    insurer: 'Acme',
    startDate: '2024-01-01',
    endDate: '2025-01-01',
    premiumAmount: 1000,
    paymentFrequency: 'annual',
    sumInsured: 500000,
    deductible: 0,
    status: 'active',
    storedStatus: 'active',
  },
];

function renderAssistant(overrides: Partial<Parameters<typeof ClaimAssistant>[0]> = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn(() => Promise.resolve());
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <ClaimAssistant
      policies={POLICIES}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

describe('missingRequiredFields', () => {
  it('lists every required field when the form is empty (R12.5)', () => {
    expect(
      missingRequiredFields({
        policyId: '',
        incidentDate: '',
        description: '',
        supportingDocuments: [],
        claimType: '',
        claimedAmount: '',
      }),
    ).toEqual(['policyId', 'incidentDate', 'description', 'supportingDocuments']);
  });

  it('reports no missing fields when all required info is present', () => {
    expect(
      missingRequiredFields({
        policyId: 'pol-1',
        incidentDate: '2024-05-01',
        description: 'Slipped and fell',
        supportingDocuments: ['bill.pdf'],
        claimType: '',
        claimedAmount: '',
      }),
    ).toEqual([]);
  });
});

describe('ClaimAssistant', () => {
  it('prevents advancing past the policy step without a selection (R12.5)', () => {
    renderAssistant();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert').textContent).toMatch(/select a policy/i);
    // Still on step 1.
    expect(screen.getByText(/Step 1 of 4/i)).not.toBeNull();
  });

  it('advances through steps and submits when all required info is present', async () => {
    const onSubmit = vi.fn((_claim?: unknown) => Promise.resolve());
    renderAssistant({ onSubmit });

    // Step 1: select a policy.
    fireEvent.change(screen.getByLabelText(/select a policy/i), {
      target: { value: 'pol-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 2: incident date.
    fireEvent.change(screen.getByLabelText(/incident date/i), {
      target: { value: '2024-05-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 3: description.
    fireEvent.change(screen.getByLabelText(/incident description/i), {
      target: { value: 'Slipped and fell at home' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Step 4: add a supporting document, then submit.
    fireEvent.change(screen.getByLabelText(/supporting documents/i), {
      target: { value: 'discharge.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /submit claim/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      policyId: 'pol-1',
      incidentDate: '2024-05-01',
      description: 'Slipped and fell at home',
      supportingDocuments: ['discharge.pdf'],
    });
  });
});
