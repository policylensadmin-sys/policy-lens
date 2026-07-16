// Upload middleware.
//
// Multer memory-storage upload constrained to policy documents: PDF, JPEG and
// PNG only, at most `MAX_UPLOAD_MB` (default 20MB) (R1.4, R1.5). Validation is
// defense-in-depth:
//
//   1. Multer `limits.fileSize` rejects oversized files → surfaced as `413`
//      by the central error handler.
//   2. `fileFilter` rejects declared MIME types / extensions outside the
//      allow-list → `400`.
//   3. `sniffFileType` inspects the buffered magic bytes after upload so a
//      spoofed extension / MIME header cannot slip through → `400`.
//
// `uploadMiddleware(field)` returns the ordered handler chain to mount on a
// route; `uploadSingle` is the ready-to-use chain for the default `file` field.

import { extname } from 'node:path';

import type { RequestHandler } from 'express';
import multer, { memoryStorage, type FileFilterCallback } from 'multer';
import type { Request } from 'express';

import { config } from '../config/index';

import { AppError } from './errorHandler';

/** An accepted upload type described by MIME, allowed extensions, and magic bytes. */
interface AllowedType {
  mime: string;
  extensions: readonly string[];
  /** Leading byte signature used to sniff the real content type. */
  magic: readonly number[];
}

const ALLOWED_TYPES: readonly AllowedType[] = [
  { mime: 'application/pdf', extensions: ['.pdf'], magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'], magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', extensions: ['.png'], magic: [0x89, 0x50, 0x4e, 0x47] },
];

const ALLOWED_MIME_LABEL = 'PDF, JPEG or PNG';

/** Max upload size in bytes, derived from configured `MAX_UPLOAD_MB`. */
const maxBytes = config.limits.maxUploadMb * 1024 * 1024;

/** Does the buffer begin with the given magic-byte signature? */
function hasMagic(buffer: Buffer, magic: readonly number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

/** Validate the declared MIME type and file extension against the allow-list. */
function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const ext = extname(file.originalname).toLowerCase();
  const match = ALLOWED_TYPES.find(
    (t) => t.mime === file.mimetype && t.extensions.includes(ext),
  );
  if (!match) {
    cb(AppError.badRequest(`Unsupported file type. Allowed types: ${ALLOWED_MIME_LABEL}`, {
      mimetype: file.mimetype,
      extension: ext,
    }));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage: memoryStorage(),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter,
});

/**
 * Post-upload content sniff: confirms the buffered file's magic bytes match a
 * type whose declared MIME the `fileFilter` already accepted. Blocks spoofed
 * extensions / MIME headers.
 */
export const sniffFileType: RequestHandler = (req, _res, next) => {
  const file = req.file;
  if (!file) {
    next(AppError.badRequest('No file provided'));
    return;
  }

  const sniffed = ALLOWED_TYPES.find((t) => hasMagic(file.buffer, t.magic));
  if (!sniffed || sniffed.mime !== file.mimetype) {
    next(
      AppError.badRequest(`File content does not match its type. Allowed types: ${ALLOWED_MIME_LABEL}`, {
        declaredMime: file.mimetype,
      }),
    );
    return;
  }

  next();
};

/**
 * Build the upload handler chain for a single file on `field` (default
 * `file`): Multer parse + size/type checks, then content sniffing.
 */
export function uploadMiddleware(field = 'file'): RequestHandler[] {
  return [upload.single(field), sniffFileType];
}

/** Ready-to-use single-file (`file`) upload chain. */
export const uploadSingle: RequestHandler[] = uploadMiddleware('file');
