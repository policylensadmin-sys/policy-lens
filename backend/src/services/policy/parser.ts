// ParserService — text extraction for uploaded policy documents (R2).
//
// Responsibilities (per design "Services" + R2.1–R2.7):
//   - PDF fast path: use pdf-parse to detect and extract an embedded,
//     selectable text layer without ever invoking OCR (R2.1). Per-page text is
//     captured so page order and boundaries are preserved (R2.4).
//   - OCR route: PDFs with no usable embedded text, and all image uploads
//     (JPEG/PNG), are sent to the injected OCRProvider (Google Vision / mock)
//     (R2.2).
//   - Mixed PDFs: because the OCRProvider contract operates on a whole file
//     buffer (it cannot be handed a single extracted PDF page), true per-page
//     OCR interleaving is not possible at this layer. We therefore apply the
//     pragmatic rule the design calls for: if a PDF's embedded text is empty or
//     falls below a usefulness threshold (including the "mostly scanned with a
//     few text pages" case), the entire document is routed to OCR; otherwise
//     the embedded text is used as-is (R2.3, documented tradeoff).
//   - Low confidence: when OCR reports overall confidence < 60%, a typed
//     LowConfidenceError is thrown so the worker can tell the user the document
//     could not be processed reliably and to re-upload a clearer copy (R2.5).
//   - Unavailable / errors: OCR provider failures are wrapped in a typed
//     OcrUnavailableError flagged retryable so the worker can surface a
//     temporary-failure/retry state (R2.6).
//   - Scale: extraction imposes no page cap, supporting 100+ page docs (R2.7).
//
// The OCRProvider is injected via the constructor so the mock or Google adapter
// (from the AI factory) can be supplied by the worker, and so this service is
// unit-testable in isolation.

import type { OCRProvider, OcrResult } from '../ai/types';

// ---------------------------------------------------------------------------
// pdf-parse loading + local typing.
//
// We import pdf-parse's internal entry (`lib/pdf-parse.js`) rather than the
// package root. The package root runs a debug self-test that reads a bundled
// sample PDF from disk when it detects it is the main module; importing the lib
// directly avoids that side effect. That subpath ships no type declarations, so
// we describe the small surface we use here and load it through an indirect
// specifier so it is imported against these local types.
// ---------------------------------------------------------------------------

/** A pdfjs text item as surfaced to a custom page renderer. */
interface PdfTextItem {
  str: string;
  /** Affine transform; index 5 is the item's Y position. */
  transform: number[];
}
/** The pdfjs page proxy handed to a custom `pagerender`. */
interface PdfPageData {
  getTextContent(options?: unknown): Promise<{ items: PdfTextItem[] }>;
}
/** Options accepted by pdf-parse. */
interface PdfParseOptions {
  /** Custom per-page renderer; return value is joined into the full text. */
  pagerender?: (pageData: PdfPageData) => string | Promise<string>;
  /** Max pages to parse (0 / undefined = all). */
  max?: number;
}
/** The subset of the pdf-parse result this service reads. */
interface PdfParseResult {
  numpages: number;
  text: string;
}
/** Signature of the pdf-parse entry function. */
type PdfParseFn = (data: Buffer | Uint8Array, options?: PdfParseOptions) => Promise<PdfParseResult>;

/** Internal pdf-parse entry that skips the package root's debug self-test. */
const PDF_PARSE_MODULE = 'pdf-parse/lib/pdf-parse.js';

/** Lazily load the pdf-parse entry function, typed against the local surface. */
async function loadPdfParse(): Promise<PdfParseFn> {
  const mod = (await import(PDF_PARSE_MODULE)) as { default?: PdfParseFn } & PdfParseFn;
  return (mod.default ?? mod) as PdfParseFn;
}

// ---------------------------------------------------------------------------
// Public result + error types.
// ---------------------------------------------------------------------------

/** Extracted text for a single page, preserving 1-based page order (R2.4). */
export interface ExtractedPage {
  /** 1-based page number. */
  page: number;
  text: string;
}

/** Outcome of {@link ParserService.extract}. */
export interface ExtractResult {
  /** Full extracted text, all pages concatenated in order. */
  text: string;
  /** Per-page text, preserving page order and boundaries (R2.4). */
  pages: ExtractedPage[];
  /** True when the OCR provider was used; false for the pdf-parse fast path. */
  usedOcr: boolean;
  /** Overall recognition confidence in [0, 1] when OCR was used; else absent. */
  confidence?: number;
}

/** Stable machine codes for parser failures the worker can branch on. */
export type ParserErrorCode =
  | 'unsupported_mime'
  | 'ocr_low_confidence'
  | 'ocr_unavailable'
  | 'empty_document';

/**
 * Base class for all parser failures. Carries a stable {@link code}, a
 * user-facing {@link userMessage} suitable for the processing-status UI, and a
 * {@link retryable} flag the worker uses to decide whether to offer a retry.
 */
export class ParserError extends Error {
  readonly code: ParserErrorCode;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(
    code: ParserErrorCode,
    message: string,
    options: { retryable: boolean; userMessage: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'ParserError';
    this.code = code;
    this.retryable = options.retryable;
    this.userMessage = options.userMessage;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the upload MIME type is not a supported document format. */
export class UnsupportedMimeError extends ParserError {
  constructor(mime: string) {
    super('unsupported_mime', `Unsupported document type "${mime}".`, {
      retryable: false,
      userMessage: 'This file type is not supported. Please upload a PDF, JPEG, or PNG.',
    });
    this.name = 'UnsupportedMimeError';
  }
}

/**
 * Thrown when OCR completes but overall confidence is below the 60% floor, so
 * the extraction cannot be trusted (R2.5).
 */
export class LowConfidenceError extends ParserError {
  readonly confidence: number;
  constructor(confidence: number) {
    super(
      'ocr_low_confidence',
      `OCR confidence ${(confidence * 100).toFixed(0)}% is below the ${(
        LOW_CONFIDENCE_THRESHOLD * 100
      ).toFixed(0)}% minimum.`,
      {
        retryable: false,
        userMessage:
          'We could not read this document reliably. Please re-upload a clearer copy or a higher-resolution scan.',
      },
    );
    this.name = 'LowConfidenceError';
    this.confidence = confidence;
  }
}

/**
 * Thrown when the OCR provider is unavailable or returns an error (R2.6). Flagged
 * retryable so the worker can offer the user a retry.
 */
export class OcrUnavailableError extends ParserError {
  constructor(cause: unknown) {
    super('ocr_unavailable', `OCR service failed: ${describeError(cause)}`, {
      retryable: true,
      userMessage:
        'Text extraction is temporarily unavailable. Please try again in a moment.',
      cause,
    });
    this.name = 'OcrUnavailableError';
  }
}

/** Thrown when neither the text layer nor OCR yielded any usable text. */
export class EmptyDocumentError extends ParserError {
  constructor() {
    super('empty_document', 'No text could be extracted from the document.', {
      retryable: false,
      userMessage:
        'We could not find any readable text in this document. Please re-upload a clearer copy.',
    });
    this.name = 'EmptyDocumentError';
  }
}

// ---------------------------------------------------------------------------
// Tuning constants.
// ---------------------------------------------------------------------------

/** OCR results below this overall confidence are rejected (R2.5, 60%). */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Supported MIME types. */
const PDF_MIME = 'application/pdf';
const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

/**
 * A PDF page is considered to carry a real embedded text layer when its
 * trimmed text has at least this many characters. Below this it is treated as a
 * scanned/blank page for routing purposes.
 */
const MIN_PAGE_TEXT_CHARS = 12;

/**
 * Minimum total embedded characters for a PDF to skip OCR. Documents below this
 * are treated as having no usable text layer and are routed to OCR.
 */
const MIN_DOC_TEXT_CHARS = 40;

/**
 * If fewer than this fraction of a multi-page PDF's pages carry embedded text,
 * the document is treated as "mostly scanned" and the whole file is routed to
 * OCR (pragmatic mixed-PDF handling; see file header re: the OCRProvider
 * whole-buffer contract).
 */
const MIN_TEXT_PAGE_RATIO = 0.5;

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/**
 * Extracts searchable text from uploaded policy documents, using the pdf-parse
 * fast path for PDFs with an embedded text layer and delegating to the injected
 * {@link OCRProvider} for scanned PDFs and images (R2).
 */
export class ParserService {
  constructor(private readonly ocr: OCRProvider) {}

  /**
   * Extract text from a document buffer of the given MIME type.
   *
   * @throws {UnsupportedMimeError} when the MIME type is not PDF/JPEG/PNG.
   * @throws {LowConfidenceError}   when OCR confidence < 60% (R2.5).
   * @throws {OcrUnavailableError}  when the OCR provider fails (R2.6).
   * @throws {EmptyDocumentError}   when no text could be extracted.
   */
  async extract(file: Buffer, mime: string): Promise<ExtractResult> {
    const normalized = mime.trim().toLowerCase();

    if (normalized === PDF_MIME) {
      return this.extractPdf(file, normalized);
    }
    if (IMAGE_MIMES.has(normalized)) {
      // Images are always scanned content — go straight to OCR (R2.2).
      return this.runOcr(file, normalized);
    }
    throw new UnsupportedMimeError(mime);
  }

  // --- PDF -----------------------------------------------------------------

  private async extractPdf(file: Buffer, mime: string): Promise<ExtractResult> {
    let pages: ExtractedPage[] | undefined;
    try {
      pages = await extractPdfPages(file);
    } catch {
      // A parse failure (corrupt/odd/encrypted-but-renderable PDF) is not fatal:
      // the document may still be OCR-able as images, so fall back to OCR.
      pages = undefined;
    }

    if (pages && hasUsableTextLayer(pages)) {
      // Fast path: embedded selectable text found — no OCR (R2.1).
      const text = joinPages(pages);
      return { text, pages, usedOcr: false };
    }

    // No usable text layer (or parse failed) → OCR the whole document (R2.2/R2.3).
    return this.runOcr(file, mime);
  }

  // --- OCR -----------------------------------------------------------------

  private async runOcr(file: Buffer, mime: string): Promise<ExtractResult> {
    let result: OcrResult;
    try {
      result = await this.ocr.extract(file, mime);
    } catch (cause) {
      // Provider unavailable / API error → retryable temporary failure (R2.6).
      throw new OcrUnavailableError(cause);
    }

    // Reject unreliable extractions before they reach analysis (R2.5).
    if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
      throw new LowConfidenceError(result.confidence);
    }

    const pages: ExtractedPage[] = result.pages.map((p) => ({ page: p.page, text: p.text }));
    const text = result.text.trim().length > 0 ? result.text : joinPages(pages);

    if (text.trim().length === 0) {
      throw new EmptyDocumentError();
    }

    return { text, pages, usedOcr: true, confidence: result.confidence };
  }
}

// ---------------------------------------------------------------------------
// pdf-parse helpers.
// ---------------------------------------------------------------------------

/**
 * Extract per-page text from a PDF buffer using pdf-parse with a custom page
 * renderer. pdf-parse invokes `pagerender` once per page in document order and
 * awaits each call, so pushing into an array preserves page order/boundaries
 * (R2.4). No page cap is set, so 100+ page documents are fully processed (R2.7).
 */
async function extractPdfPages(file: Buffer): Promise<ExtractedPage[]> {
  const pdfParse = await loadPdfParse();

  const pageTexts: string[] = [];
  await pdfParse(file, {
    pagerender: async (pageData: PdfPageData) => {
      const rendered = await renderPage(pageData);
      pageTexts.push(rendered);
      return rendered;
    },
  });

  return pageTexts.map((text, i) => ({ page: i + 1, text }));
}

/**
 * Render one PDF page's text content to a string, inserting a newline whenever
 * the vertical position changes (mirrors pdf-parse's default renderer so text
 * quality is consistent).
 */
async function renderPage(pageData: {
  getTextContent(options?: unknown): Promise<{ items: { str: string; transform: number[] }[] }>;
}): Promise<string> {
  const content = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  let lastY: number | undefined;
  let text = '';
  for (const item of content.items) {
    const y = item.transform[5];
    if (lastY === y || lastY === undefined) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }
    lastY = y;
  }
  return text;
}

/**
 * Decide whether a PDF's embedded text layer is usable enough to skip OCR.
 * Requires both a minimum total character count and, for multi-page documents,
 * a minimum fraction of pages that actually carry text — this catches the
 * "mostly scanned" mixed case and routes it to OCR (R2.3, pragmatic).
 */
function hasUsableTextLayer(pages: ExtractedPage[]): boolean {
  const totalChars = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
  if (totalChars < MIN_DOC_TEXT_CHARS) return false;

  const textPages = pages.filter((p) => p.text.trim().length >= MIN_PAGE_TEXT_CHARS).length;
  if (pages.length > 1 && textPages / pages.length < MIN_TEXT_PAGE_RATIO) return false;

  return textPages > 0;
}

// ---------------------------------------------------------------------------
// Misc helpers.
// ---------------------------------------------------------------------------

/** Concatenate page texts in order with blank-line separators. */
function joinPages(pages: ExtractedPage[]): string {
  return pages.map((p) => p.text).join('\n\n');
}

/** Best-effort human-readable description of an unknown thrown value. */
function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'unknown error';
}
