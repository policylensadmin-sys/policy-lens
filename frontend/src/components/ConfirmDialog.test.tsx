import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Tests for the confirmation dialog used to guard destructive actions (R6.5).
 */
describe('ConfirmDialog', () => {
  it('does not render when closed', () => {
    render(
      <ConfirmDialog open={false} title="Delete?" message="msg" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('invokes onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete this policy?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('surfaces an inline error so the user can retry (R6.7)', () => {
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="msg"
        error="Storage unavailable"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Storage unavailable');
  });

  it('disables buttons while pending', () => {
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="msg"
        pending
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Working…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
