import { useEffect, useRef } from 'react';

/**
 * ConfirmDialog — a small accessible confirmation modal (R6.5).
 *
 * Used to guard destructive actions (e.g. deleting a policy from the vault).
 * Renders an overlay with a titled dialog, a descriptive message, and
 * confirm/cancel buttons. The confirm button reflects a pending state so the
 * async delete can disable interaction while it runs, and an optional error
 * message is surfaced inline so the user can retry (R6.7).
 *
 * Accessibility: the dialog uses `role="dialog"` + `aria-modal`, focuses the
 * cancel button on open, and closes on `Escape`.
 */

interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Dialog heading. */
  title: string;
  /** Body copy explaining the consequence of confirming. */
  message: string;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** True while the confirm action is running; disables the buttons. */
  pending?: boolean;
  /** Inline error to display (e.g. a failed delete) so the user can retry. */
  error?: string | null;
  /** Marks the confirm action as destructive (danger styling). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  pending = false,
  error = null,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel button and wire Escape-to-close while open.
  useEffect(() => {
    if (!open) {
      return;
    }
    cancelRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, pending, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!pending) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-md px-4 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
              destructive ? 'bg-danger' : 'bg-accent'
            }`}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
