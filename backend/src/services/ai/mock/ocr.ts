// Mock OCR provider (Demo/Mock mode, R2).
//
// Returns bundled sample policy text so the parsing/analysis pipeline can run
// end-to-end without Google Vision credentials. Which sample is returned is
// chosen deterministically from a hash of the input buffer, so a given file
// always yields the same text while different uploads get varied documents.

import type { OCRProvider, OcrPage, OcrResult } from '../types';
import { fnv1a } from './hash';
import { HEALTH_SAMPLE, SAMPLE_DOCUMENTS, type SampleDocument } from './samples';

/** Fixed per-page confidence reported by the mock OCR adapter. */
const MOCK_CONFIDENCE = 0.95;

/** Deterministic mock OCR provider backed by bundled sample documents. */
export class MockOCRProvider implements OCRProvider {
  extract(file: Buffer, _mime: string): Promise<OcrResult> {
    const sample = selectSample(file);
    return Promise.resolve(toOcrResult(sample));
  }
}

/** Pick a bundled sample deterministically from the file contents. */
function selectSample(file: Buffer): SampleDocument {
  // Hash a bounded prefix so large files stay fast; fall back to length only
  // when the buffer is empty.
  const key = file.length > 0 ? file.subarray(0, 4096).toString('latin1') : 'empty';
  const index = fnv1a(key) % SAMPLE_DOCUMENTS.length;
  return SAMPLE_DOCUMENTS[index] ?? HEALTH_SAMPLE;
}

/** Convert a sample document into an {@link OcrResult}. */
function toOcrResult(sample: SampleDocument): OcrResult {
  const pages: OcrPage[] = sample.pages.map((text, i) => ({
    page: i + 1,
    text,
    confidence: MOCK_CONFIDENCE,
  }));
  return {
    text: sample.pages.join('\n\n'),
    pages,
    confidence: MOCK_CONFIDENCE,
  };
}
