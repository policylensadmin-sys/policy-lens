// Google Gemini adapters — AI provider (chat/analysis) + embedding provider.
//
// - GeminiAIProvider  : wraps the Gemini generateContent API in the shared
//                       strict-JSON pipeline (structured.ts), so analysis/chat/
//                       compare/claim-sim/insights all validate + repair against
//                       the same zod schemas as the other live providers.
// - GeminiEmbeddingProvider : real embeddings for RAG search (R15) via
//                       `gemini-embedding-001`, requested at `dim` output size
//                       (Matryoshka) so vectors match the pgvector(1536) column
//                       — no DB migration needed.
//
// Reads GEMINI_API_KEY / GEMINI_MODEL / GEMINI_EMBEDDING_MODEL. Network calls go
// through `callWithResilience` (timeout + one retry).

import { GoogleGenerativeAI } from '@google/generative-ai';

import { readAiEnv } from '../../config/env';
import { callWithResilience } from './net';
import { StructuredAIProvider, type LlmChatClient, type LlmMessage } from './structured';
import type { AIProvider, EmbeddingProvider } from './types';

/** Default Gemini chat/analysis model. */
const DEFAULT_MODEL = 'gemini-2.0-flash';
/** Default Gemini embedding model (supports configurable output dimensions). */
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

/** Transport client backed by the Gemini generateContent API (JSON output). */
class GeminiChatClient implements LlmChatClient {
  readonly name = 'gemini';

  constructor(
    private readonly client: GoogleGenerativeAI,
    private readonly model: string,
  ) {}

  async complete(messages: LlmMessage[]): Promise<string> {
    // Gemini keeps the system prompt separate and uses role 'model' (not
    // 'assistant') for prior model turns.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const model = this.client.getGenerativeModel({
      model: this.model,
      ...(system ? { systemInstruction: system } : {}),
      // Force strict JSON output so structured.ts can parse it directly.
      generationConfig: { responseMimeType: 'application/json' },
    });

    const response = await callWithResilience(
      () => model.generateContent({ contents }),
      { label: 'gemini.generateContent' },
    );
    return response.response.text();
  }
}

/**
 * Build the live Gemini AI provider. Reads `GEMINI_API_KEY` and `GEMINI_MODEL`;
 * the factory only selects this adapter when the API key is present.
 */
export function createGeminiAIProvider(): AIProvider {
  const env = readAiEnv();
  const apiKey = env.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('createGeminiAIProvider: GEMINI_API_KEY is not set.');
  }
  const model = env.geminiModel ?? DEFAULT_MODEL;
  return new StructuredAIProvider(new GeminiChatClient(new GoogleGenerativeAI(apiKey), model));
}

/** Gemini-backed embedding provider for RAG search (R15). */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;

  constructor(
    private readonly client: GoogleGenerativeAI,
    private readonly model: string,
    dim: number,
  ) {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`GeminiEmbeddingProvider requires a positive integer dim (got ${dim}).`);
    }
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const model = this.client.getGenerativeModel({ model: this.model });

    // Embed each text, requesting the configured output dimensionality so the
    // vectors line up with the pgvector column. Normalize the length as a
    // safety net so a DB insert can never fail on a dimension mismatch.
    const vectors: number[][] = [];
    for (const text of texts) {
      const result = await callWithResilience(
        () =>
          model.embedContent({
            content: { role: 'user', parts: [{ text }] },
            outputDimensionality: this.dim,
          } as Parameters<typeof model.embedContent>[0]),
        { label: 'gemini.embedContent' },
      );
      vectors.push(this.fitToDim(result.embedding?.values ?? []));
    }
    return vectors;
  }

  /** Truncate/pad a vector to exactly `dim` so pgvector inserts never fail. */
  private fitToDim(values: number[]): number[] {
    if (values.length === this.dim) return values;
    if (values.length > this.dim) return values.slice(0, this.dim);
    return [...values, ...new Array<number>(this.dim - values.length).fill(0)];
  }
}

/**
 * Build the live Gemini embedding provider. Reads `GEMINI_API_KEY` and
 * `GEMINI_EMBEDDING_MODEL`; `dim` comes from the factory (EMBEDDING_DIM).
 */
export function createGeminiEmbeddingProvider(dim: number): EmbeddingProvider {
  const env = readAiEnv();
  const apiKey = env.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('createGeminiEmbeddingProvider: GEMINI_API_KEY is not set.');
  }
  const model = env.geminiEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  return new GeminiEmbeddingProvider(new GoogleGenerativeAI(apiKey), model, dim);
}

export { GeminiChatClient };
