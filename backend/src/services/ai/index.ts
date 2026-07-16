// AI abstraction layer — public surface.
//
// Provider interfaces, selection types, and the factory used to build the
// configured AI / embedding / OCR providers (with Demo/Mock fallback).

export type {
  AIProvider,
  EmbeddingProvider,
  OCRProvider,
  AiProviders,
  AIProviderKind,
  EmbeddingProviderKind,
  OCRProviderKind,
  OcrPage,
  OcrResult,
} from './types';

export {
  createAiProviders,
  type CreateAiProvidersOptions,
  type FactoryLogger,
} from './factory';

export { ProviderNotImplementedError } from './stubs';

export {
  MockAIProvider,
  MockEmbeddingProvider,
  MockOCRProvider,
  createMockAIProvider,
  createMockEmbeddingProvider,
  createMockOCRProvider,
} from './mock';
