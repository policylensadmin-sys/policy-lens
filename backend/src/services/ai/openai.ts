// OpenAI AI + embedding provider adapters (R3, R5, R7, R8, R13, R15).
//
// - OpenAIAIProvider  : chat completions with `response_format: json_object`
//                       so the model always returns strict JSON, wrapped in the
//                       shared parse/repair pipeline (`structured.ts`).
// - OpenAIEmbeddingProvider : batch embeddings for RAG search (R15), sized to
//                       the pgvector column via EMBEDDING_DIM / model default.
//
// All network calls go through `callWithResilience` for timeout + one retry.

import OpenAI from 'openai';
import { readAiEnv } from '../../config/env';
import { callWithResilience } from './net';
import { StructuredAIProvider, type LlmChatClient, type LlmMessage } from './structured';
import type { AIProvider, EmbeddingProvider } from './types';

/** Default chat model when `OPENAI_MODEL` is not set. */
const DEFAULT_MODEL = 'gpt-4o-mini';
/** Default embedding model when `EMBEDDING_MODEL` is not set. */
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/** Transport client backed by the OpenAI Chat Completions API (JSON mode). */
class OpenAIChatClient implements LlmChatClient {
  readonly name = 'openai';

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async complete(messages: LlmMessage[]): Promise<string> {
    const response = await callWithResilience(
      () =>
        this.client.chat.completions.create({
          model: this.model,
          // JSON mode guarantees syntactically valid JSON output. Our prompts
          // already contain the word "JSON", which the API requires here.
          response_format: { type: 'json_object' },
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      { label: 'openai.chat.completions.create' },
    );
    return response.choices[0]?.message?.content ?? '';
  }
}

/**
 * Build the live OpenAI AI provider. Reads `OPENAI_API_KEY` and `OPENAI_MODEL`
 * from the environment; the factory only selects this adapter when the API key
 * is present.
 */
export function createOpenAIAIProvider(): AIProvider {
  const env = readAiEnv();
  const apiKey = env.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('createOpenAIAIProvider: OPENAI_API_KEY is not set.');
  }
  const model = env.openaiModel ?? DEFAULT_MODEL;
  const client = new OpenAI({ apiKey, ...(env.openaiBaseUrl ? { baseURL: env.openaiBaseUrl } : {}) });
  return new StructuredAIProvider(new OpenAIChatClient(client, model));
}

/** OpenAI-backed embedding provider for RAG search (R15). */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    dim: number,
  ) {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`OpenAIEmbeddingProvider requires a positive integer dim (got ${dim}).`);
    }
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await callWithResilience(
      () =>
        this.client.embeddings.create({
          model: this.model,
          input: texts,
          // v3 embedding models support shortening vectors to a target size so
          // they match the pgvector column dimension.
          dimensions: this.dim,
        }),
      { label: 'openai.embeddings.create' },
    );

    // Preserve input order (the API returns an `index` per item).
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding as number[]);
  }
}

/**
 * Build the live OpenAI embedding provider. Reads `OPENAI_API_KEY` and
 * `EMBEDDING_MODEL`; `dim` comes from the factory (EMBEDDING_DIM), defaulting
 * to the model's native size.
 */
export function createOpenAIEmbeddingProvider(dim: number): EmbeddingProvider {
  const env = readAiEnv();
  const apiKey = env.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('createOpenAIEmbeddingProvider: OPENAI_API_KEY is not set.');
  }
  const model = env.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const client = new OpenAI({ apiKey, ...(env.openaiBaseUrl ? { baseURL: env.openaiBaseUrl } : {}) });
  return new OpenAIEmbeddingProvider(client, model, dim);
}

export { OpenAIChatClient };
