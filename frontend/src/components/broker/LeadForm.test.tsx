import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeadForm } from './LeadForm';
import type { LeadView } from './types';

/**
 * LeadForm (R19.4). Verifies name is required before submit, and that editing
 * pre-fills the existing lead's fields.
 */

describe('LeadForm', () => {
  it('blocks submission and shows an error when name is empty (R19.4)', () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<LeadForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /add lead/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/name is required/i);
  });

  it('submits trimmed values when name is provided (R19.4)', () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<LeadForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: '  Priya  ' },
    });
    fireEvent.change(screen.getByLabelText(/contact/i), {
      target: { value: 'priya@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add lead/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Priya',
      contact: 'priya@example.com',
      stage: '',
      notes: '',
    });
  });

  it('pre-fills fields when editing an existing lead (R19.4)', () => {
    const lead: LeadView = {
      id: 'lead-1',
      brokerId: 'brk-1',
      name: 'Existing Lead',
      contact: '555-1234',
      stage: 'Contacted',
      notes: 'Follow up next week',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    render(<LeadForm lead={lead} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe(
      'Existing Lead',
    );
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeNull();
  });
});
