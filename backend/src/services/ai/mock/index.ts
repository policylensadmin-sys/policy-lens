// Mock provider adapters (Demo/Mock mode).
//
// Deterministic, zero-credential implementations of the AI, embedding, and OCR
// provider interfaces. The factory wires these in whenever a provider is set to
// `mock` or falls back due to missing credentials.

import type { AIProvider, EmbeddingProvider, OCRProvider } from '../types';
import { MockAIProvider } from './ai';
import { MockEmbeddingProvider } from './embedding';
import { MockOCRProvider } from './ocr';

export { MockAIProvider } from './ai';
export { MockEmbeddingProvider } from './embedding';
export { MockOCRProvider } from './ocr';
export { SAMPLE_DOCUMENTS, HEALTH_SAMPLE, MOTOR_SAMPLE, TRAVEL_SAMPLE } from './samples';
export type { SampleDocument } from './samples';

/** Build the deterministic mock AI provider. */
export function createMockAIProvider(): AIProvider {
  return new MockAIProvider();
}

/** Build the deterministic hash-based mock embedding provider of the given dim. */
export function createMockEmbeddingProvider(dim: number): EmbeddingProvider {
  return new MockEmbeddingProvider(dim);
}

/** Build the mock OCR provider that returns bundled sample policy text. */
export function createMockOCRProvider(): OCRProvider {
  return new MockOCRProvider();
}
