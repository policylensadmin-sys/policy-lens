import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

/**
 * Reusable upload dropzone for the customer portal (R1.1–R1.5).
 *
 * Supports both drag-and-drop and a click-to-browse file picker, accepting
 * PDF/JPEG/PNG up to 20 MB. Format and size are validated client-side before
 * the file leaves the browser, surfacing a friendly, specific error message
 * for unsupported formats (R1.4) and oversized files (R1.5). Valid selections
 * are handed to the parent via `onFileSelected`; the parent owns the actual
 * upload request.
 */

/** MIME types accepted by the upload flow (R1.4). */
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** File extensions mirrored on the native picker for convenience. */
const ACCEPTED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/** Maximum accepted upload size in bytes (20 MB, R1.5). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const UNSUPPORTED_FORMAT_MESSAGE =
  'Unsupported format. Please upload a PDF, JPEG, or PNG file.';
const OVERSIZED_MESSAGE =
  'That file is larger than the 20 MB limit. Please upload a smaller file.';

/**
 * Validates a candidate file against the accepted formats and size cap.
 * Returns a user-facing error message, or `null` when the file is valid.
 */
export function validateUploadFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return UNSUPPORTED_FORMAT_MESSAGE;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return OVERSIZED_MESSAGE;
  }
  return null;
}

interface UploadDropzoneProps {
  /** Called with a validated file ready to upload. */
  onFileSelected: (file: File) => void;
  /** Disables interaction (e.g. while an upload is in flight). */
  disabled?: boolean;
}

export function UploadDropzone({ onFileSelected, disabled = false }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(file: File | undefined) {
    if (!file) {
      return;
    }
    const validationError = validateUploadFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onFileSelected(file);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so re-selecting the same file still fires a change event.
    event.target.value = '';
    accept(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (disabled) {
      return;
    }
    accept(event.dataTransfer.files?.[0]);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      setDragActive(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function openPicker() {
    if (!disabled) {
      inputRef.current?.click();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Upload a policy document"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center gap-4 rounded-xl border border-dashed p-10 text-center transition ${
          dragActive ? 'border-accent bg-accent/5' : 'border-border bg-surface'
        } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-accent'}`}
      >
        <span className="font-display text-lg text-foreground">
          Drag &amp; drop your policy here
        </span>
        <p className="text-sm text-muted">or click to browse — PDF, JPEG, or PNG up to 20 MB.</p>
        <span className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background">
          Choose a file
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          disabled={disabled}
          onChange={handleInputChange}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default UploadDropzone;
