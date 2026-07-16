// AI abstraction layer — provider interfaces and selection types.
//
// These interfaces define the provider-agnostic contract the rest of the
// backend depends on. Concrete adapters (mock / Google Vision / Anthropic /
// OpenAI) are implemented in tasks 4.2–4.4 and selected at runtime by the
// factory in `factory.ts`.

import type {
  ChunkContext,
  ClaimResult,
  ComparisonResult,
  GroundedAnswer,
  Insight,
  PolicyAnalysis,
  PortfolioSummary,
} from '@policylens/shared';

// ---------------------------------------------------------------------------
// OCR result shape (local to the AI layer; not part of the shared API types).
// ---------------------------------------------------------------------------

/** Extracted text for a single page of a document. */
export interface OcrPage {
  /** 1-based page number. */
  page: number;
  text: string;
  /** Per-page recognition confidence in [0, 1], when available. */
  confidence?: number;
}

/** Result of extracting text from a document via an {@link OCRProvider}. */
export interface OcrResult {
  /** Full extracted text (all pages concatenated in order). */
  text: string;
  /** Per-page extraction results, preserving page order. */
  pages: OcrPage[];
  /** Overall recognition confidence in [0, 1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Provider interfaces.
// ---------------------------------------------------------------------------

/**
 * LLM-backed intelligence for policy analysis, grounded chat, comparison,
 * claim simulation, and broker insights (R3, R5, R7, R8, R13).
 */
export interface AIProvider {
  /** Produce structured, schema-valid analysis from raw policy text (R3). */
  analyzePolicy(text: string): Promise<PolicyAnalysis>;
  /** Answer a question grounded in retrieved policy chunks (R5). */
  answerQuestion(ctx: ChunkContext[], q: string): Promise<GroundedAnswer>;
  /** Produce a structured A/B comparison of two analyses (R7). */
  comparePolicies(a: PolicyAnalysis, b: PolicyAnalysis): Promise<ComparisonResult>;
  /** Evaluate a claim scenario against a policy analysis (R8). */
  simulateClaim(analysis: PolicyAnalysis, scenario: string): Promise<ClaimResult>;
  /** Generate categorized insights for a broker portfolio (R13). */
  brokerInsights(portfolio: PortfolioSummary): Promise<Insight[]>;
}

/** Produces vector embeddings for text chunks used in RAG search (R15). */
export interface EmbeddingProvider {
  /** Embed a batch of texts; returns one vector per input, in order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensionality of the produced vectors (must match the pgvector column). */
  readonly dim: number;
}

/** Extracts text from an uploaded document, via OCR when needed (R2). */
export interface OCRProvider {
  /** Extract text from a file buffer of the given MIME type. */
  extract(file: Buffer, mime: string): Promise<OcrResult>;
}

// ---------------------------------------------------------------------------
// Provider selection kinds (mirror the env values).
// ---------------------------------------------------------------------------

/** Selectable AI providers (`AI_PROVIDER`). */
export type AIProviderKind = 'anthropic' | 'openai' | 'mock';
/** Selectable embedding providers (`EMBEDDING_PROVIDER`). */
export type EmbeddingProviderKind = 'openai' | 'mock';
/** Selectable OCR providers (`OCR_PROVIDER`). */
export type OCRProviderKind = 'google' | 'ocrspace' | 'mock';

/** The resolved bundle of providers returned by the factory. */
export interface AiProviders {
  ai: AIProvider;
  embedding: EmbeddingProvider;
  ocr: OCRProvider;
}
