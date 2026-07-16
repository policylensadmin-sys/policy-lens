// Unit tests for ParserService routing + error handling (R2).
//
// These cover the behaviours that don't depend on real PDF binaries: image →
// OCR routing, the low-confidence rejection (R2.5), OCR-unavailable wrapping
// (R2.6), unsupported MIME rejection, and page-order preservation (R2.4). PDF
// text-layer detection is exercised end-to-end by the worker/integration
// suites where real fixtures are available.

import { describe, expect, it, vi } from 'vitest';

import type { OCRProvider, OcrResult } from '../ai/types';
import {
  EmptyDocumentError,
  LowConfidenceError,
  OcrUnavailableError,
  ParserService,
  UnsupportedMimeError,
} from './parser';

/** A minimal OCRProvider stub returning a fixed result (or throwing). */
function fakeOcr(impl: (file: Buffer, mime: string) => Promise<OcrResult>): OCRProvider {
  return { extract: vi.fn(impl) };
}

const PNG = 'image/png';
const JPEG = 'image/jpeg';

function ocrResult(pages: { page: number; text: string }[], confidence: number): OcrResult {
  return {
    text: pages.map((p) => p.text).join('\n\n'),
    pages: pages.map((p) => ({ ...p, confidence })),
    confidence,
  };
}

describe('ParserService', () => {
  it('routes image uploads to OCR and preserves page order (R2.2, R2.4)', async () => {
    const ocr = fakeOcr(() =>
      Promise.resolve(
        ocrResult(
          [
            { page: 1, text: 'first page' },
            { page: 2, text: 'second page' },
          ],
          0.95,
        ),
      ),
    );
    const parser = new ParserService(ocr);

    const result = await parser.extract(Buffer.from('img'), PNG);

    expect(ocr.extract).toHaveBeenCalledOnce();
    expect(result.usedOcr).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(result.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(result.text).toContain('first page');
    expect(result.text).toContain('second page');
  });

  it('rejects OCR results below the 60% confidence floor (R2.5)', async () => {
    const parser = new ParserService(
      fakeOcr(() => Promise.resolve(ocrResult([{ page: 1, text: 'blurry' }], 0.4))),
    );

    await expect(parser.extract(Buffer.from('img'), JPEG)).rejects.toBeInstanceOf(
      LowConfidenceError,
    );
  });

  it('accepts OCR results at exactly the confidence floor', async () => {
    const parser = new ParserService(
      fakeOcr(() => Promise.resolve(ocrResult([{ page: 1, text: 'ok text' }], 0.6))),
    );

    const result = await parser.extract(Buffer.from('img'), JPEG);
    expect(result.usedOcr).toBe(true);
  });

  it('wraps OCR provider failures as a retryable OcrUnavailableError (R2.6)', async () => {
    const parser = new ParserService(
      fakeOcr(() => Promise.reject(new Error('vision down'))),
    );

    const error = await parser.extract(Buffer.from('img'), PNG).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrUnavailableError);
    expect((error as OcrUnavailableError).retryable).toBe(true);
  });

  it('throws EmptyDocumentError when OCR yields no text', async () => {
    const parser = new ParserService(
      fakeOcr(() => Promise.resolve(ocrResult([{ page: 1, text: '   ' }], 0.9))),
    );

    await expect(parser.extract(Buffer.from('img'), PNG)).rejects.toBeInstanceOf(
      EmptyDocumentError,
    );
  });

  it('rejects unsupported MIME types (R1.4/R2)', async () => {
    const parser = new ParserService(fakeOcr(() => Promise.reject(new Error('unused'))));

    await expect(parser.extract(Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(
      UnsupportedMimeError,
    );
  });
});
