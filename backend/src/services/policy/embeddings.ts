// EmbeddingsService — generate and persist chunk embeddings (R15.1, R15.4).
//
// Given the chunks produced by the ChunkingService, this service:
//   1. embeds every chunk's content in a single batched call to the injected
//      EmbeddingProvider (one vector per chunk, in order); and
//   2. persists each chunk to the `policy_chunks` table (policy_id, chunk_index,
//      content, section, page, embedding) via the Supabase service-role client.
//
// The vector is written in pgvector's textual form (`[0.1,0.2,...]`), which
// supabase-js accepts when inserting into a `vector` column.
//
// Both collaborators are injectable so the service is easy to unit-test with a
// fake EmbeddingProvider and a fake Supabase client; in production it defaults
// to the shared service-role client (the worker runs outside any user session).

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import type { EmbeddingProvider } from '../ai/types';
import type { Chunk } from './chunking';

/** Table that stores chunked policy text with pgvector embeddings. */
const POLICY_CHUNKS_TABLE = 'policy_chunks';

/** Default number of rows inserted per batch. */
export const DEFAULT_INSERT_BATCH_SIZE = 100;

/** A single `policy_chunks` row prepared for insertion. */
interface PolicyChunkRow {
  policy_id: string;
  chunk_index: number;
  content: string;
  section: string | null;
  page: number | null;
  embedding: string;
}

/** Lazily provide the shared service-role client (server-only, bypasses RLS). */
function defaultClientFactory(): SupabaseClient {
  return getSupabaseServiceRoleClient();
}

/**
 * Format a numeric vector into pgvector's textual literal form, e.g.
 * `[0.1,0.2,0.3]`. supabase-js sends this string as-is for a `vector` column.
 */
export function formatVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Generates embeddings for policy chunks and persists them to `policy_chunks`.
 */
export class EmbeddingsService {
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly getClient: () => SupabaseClient;
  private readonly insertBatchSize: number;

  /**
   * @param embeddingProvider Produces one vector per chunk (batched).
   * @param options.client    Supabase client (defaults to the service-role client).
   * @param options.insertBatchSize Rows per insert batch (defaults to {@link DEFAULT_INSERT_BATCH_SIZE}).
   */
  constructor(
    embeddingProvider: EmbeddingProvider,
    options: {
      client?: SupabaseClient;
      insertBatchSize?: number;
    } = {},
  ) {
    this.embeddingProvider = embeddingProvider;
    this.getClient = options.client ? () => options.client! : defaultClientFactory;
    this.insertBatchSize =
      options.insertBatchSize && options.insertBatchSize > 0
        ? options.insertBatchSize
        : DEFAULT_INSERT_BATCH_SIZE;
  }

  /**
   * Embed every chunk's content and persist the chunks (with vectors and
   * page/section metadata) to `policy_chunks` for the given policy.
   *
   * Inserts are batched. A no-op when `chunks` is empty.
   */
  async embedAndStore(policyId: string, chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const vectors = await this.embeddingProvider.embed(
      chunks.map((chunk) => chunk.content),
    );

    if (vectors.length !== chunks.length) {
      throw new Error(
        `Embedding count (${vectors.length}) does not match chunk count (${chunks.length}).`,
      );
    }

    const rows: PolicyChunkRow[] = chunks.map((chunk, i) => ({
      policy_id: policyId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      section: chunk.section ?? null,
      page: chunk.page ?? null,
      embedding: formatVector(vectors[i]!),
    }));

    const client = this.getClient();
    for (let start = 0; start < rows.length; start += this.insertBatchSize) {
      const batch = rows.slice(start, start + this.insertBatchSize);
      const { error } = await client.from(POLICY_CHUNKS_TABLE).insert(batch);
      if (error) {
        throw new Error(`Failed to persist policy chunks: ${error.message}`);
      }
    }
  }

  /**
   * Embed a single query string for semantic search / RAG retrieval, returning
   * the raw vector (callers format it for `match_policy_chunks` as needed).
   */
  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embeddingProvider.embed([text]);
    if (!vector) {
      throw new Error('Embedding provider returned no vector for the query.');
    }
    return vector;
  }
}
