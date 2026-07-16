// OCR.space OCR provider (R2.2, R2.5, R2.6).
//
// A real, HTTP-based OCR adapter that reads the *actual* uploaded document via
// the OCR.space API (https://ocr.space/OCRAPI). It handles scanned PDFs and
// images; typed/searchable PDFs never reach here because ParserService uses
// pdf-parse first.
//
// Auth: reads OCRSPACE_API_KEY. If unset it falls back to the free public demo
// key `helloworld`, which works out of the box but is rate-limited and caps
// files at ~1MB / 3 PDF pages — register a free key at https://ocr.space/ocrapi
// for real use.
//
// Network calls go through `callWithResilience` (timeout + one retry); an API
// error throws so ParserService can surface a retryable failure (R2.6).

import { readAiEnv } from '../../config/env';
import { callWithResilience } from './net';
import type { OCRProvider, OcrPage, OcrResult } from './types';

/** OCR.space parse endpoint. */
const OCRSPACE_URL = 'https://api.ocr.space/parse/image';
/** Free public demo key (rate-limited; override with OCRSPACE_API_KEY). */
const DEFAULT_API_KEY = 'helloworld';
/** Confidence assigned to a page with extracted text (OCR.space omits scores). */
const CONFIDENCE_WITH_TEXT = 0.9;

/** Minimal shape of the OCR.space JSON response (only fields we read). */
interface OcrSpaceResponse {
  ParsedResults?: Array<{ ParsedText?: string | null }> | null;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[] | null;
  ErrorDetails?: string | null;
}

/** Thrown when OCR.space returns an error or an unusable response. */
export class OcrSpaceError extends Error {
  constructor(message: string) {
    super(`OCR.space failed: ${message}`);
    this.name = 'OcrSpaceError';
  }
}

/** Map a MIME type to the OCR.space `filetype` parameter. */
function fileTypeParam(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('pdf')) return 'PDF';
  if (m.includes('png')) return 'PNG';
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPG';
  return 'Auto';
}

/** OCR.space-backed OCR provider. */
export class OcrSpaceOCRProvider implements OCRProvider {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs?: number,
    private readonly retries?: number,
  ) {}

  async extract(file: Buffer, mime: string): Promise<OcrResult> {
    const ft = fileTypeParam(mime);
    const body = new URLSearchParams();
    body.set('apikey', this.apiKey);
    body.set('base64Image', `data:${mime};base64,${file.toString('base64')}`);
    body.set('filetype', ft);
    body.set('isOverlayRequired', 'false');
    body.set('scale', 'true');
    body.set('detectOrientation', 'true');
    // Engine 2 is more accurate for images; the default engine handles PDFs
    // (including multi-page splitting on the free tier).
    if (ft !== 'PDF') body.set('OCREngine', '2');

    const json = await callWithResilience<OcrSpaceResponse>(
      async () => {
        const res = await fetch(OCRSPACE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!res.ok) {
          throw new OcrSpaceError(`HTTP ${res.status} ${res.statusText}`);
        }
        return (await res.json()) as OcrSpaceResponse;
      },
      { label: 'ocrspace.parse', timeoutMs: this.timeoutMs, retries: this.retries },
    );

    if (json.IsErroredOnProcessing) {
      const msg = Array.isArray(json.ErrorMessage)
        ? json.ErrorMessage.join('; ')
        : json.ErrorMessage || json.ErrorDetails || 'processing error';
      throw new OcrSpaceError(msg);
    }

    const results = json.ParsedResults ?? [];
    const pages: OcrPage[] = results.map((r, i) => ({
      page: i + 1,
      text: (r.ParsedText ?? '').trim(),
      confidence: CONFIDENCE_WITH_TEXT,
    }));

    const text = pages.map((p) => p.text).join('\n\n').trim();
    if (text.length === 0) {
      // No text at all — report zero confidence so ParserService flags it (R2.5).
      return { text: '', pages: [{ page: 1, text: '', confidence: 0 }], confidence: 0 };
    }
    return { text, pages, confidence: CONFIDENCE_WITH_TEXT };
  }
}

/** Build the OCR.space provider from configuration (defaults to the demo key). */
export function createOcrSpaceOCRProvider(): OCRProvider {
  const env = readAiEnv();
  return new OcrSpaceOCRProvider(env.ocrSpaceApiKey ?? DEFAULT_API_KEY);
}
