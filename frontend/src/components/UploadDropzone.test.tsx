import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  UploadDropzone,
  validateUploadFile,
  MAX_UPLOAD_BYTES,
} from './UploadDropzone';

/**
 * Tests for the upload dropzone client-side validation (R1.4, R1.5).
 */

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  // File.size is read-only; redefine for the size-limit checks.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateUploadFile', () => {
  it('accepts a PDF within the size limit', () => {
    expect(validateUploadFile(makeFile('policy.pdf', 'application/pdf', 1_000))).toBeNull();
  });

  it('accepts JPEG and PNG images', () => {
    expect(validateUploadFile(makeFile('scan.jpg', 'image/jpeg', 1_000))).toBeNull();
    expect(validateUploadFile(makeFile('scan.png', 'image/png', 1_000))).toBeNull();
  });

  it('rejects unsupported formats with a format message (R1.4)', () => {
    const message = validateUploadFile(makeFile('notes.txt', 'text/plain', 1_000));
    expect(message).toMatch(/PDF, JPEG, or PNG/);
  });

  it('rejects files over 20 MB with a size message (R1.5)', () => {
    const message = validateUploadFile(
      makeFile('big.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1),
    );
    expect(message).toMatch(/20 MB/);
  });
});

describe('UploadDropzone', () => {
  function selectFile(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('forwards a valid file to onFileSelected', () => {
    const onFileSelected = vi.fn();
    const { container } = render(<UploadDropzone onFileSelected={onFileSelected} />);
    selectFile(container, makeFile('policy.pdf', 'application/pdf', 2_000));
    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error and does not forward an unsupported file (R1.4)', () => {
    const onFileSelected = vi.fn();
    const { container } = render(<UploadDropzone onFileSelected={onFileSelected} />);
    selectFile(container, makeFile('notes.txt', 'text/plain', 2_000));
    expect(onFileSelected).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/PDF, JPEG, or PNG/);
  });

  it('shows an error for oversized files (R1.5)', () => {
    const onFileSelected = vi.fn();
    const { container } = render(<UploadDropzone onFileSelected={onFileSelected} />);
    selectFile(container, makeFile('big.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1));
    expect(onFileSelected).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/20 MB/);
  });
});
