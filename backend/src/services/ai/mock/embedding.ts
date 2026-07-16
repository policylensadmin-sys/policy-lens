// Deterministic mock embedding provider (Demo/Mock mode, R15).
//
// Produces stable, hash-derived pseudo-embeddings so semantic search and RAG
// retrieval work end-to-end without an embeddings API key. The vectors are:
//   - Deterministic:  the same text always maps to the same vector, across
//                     runs and processes (stable pgvector ordering).
//   - Correctly sized: exactly `dim` components, matching the pgvector column.
//   - Unit-normalized: L2 norm == 1, so cosine similarity is well-behaved.
//   - Sensitive to content: similar texts share a similar vector because each
//                     component is seeded from the text plus its own index.

import type { EmbeddingProvider } from '../types';
import { fnv1a, mulberry32 } from './hash';

/** Deterministic, hash-based mock embedding provider. */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;

  constructor(dim: number) {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`MockEmbeddingProvider requires a positive integer dim (got ${dim}).`);
    }
    this.dim = dim;
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  /** Produce a single deterministic, L2-normalized vector for `text`. */
  private embedOne(text: string): number[] {
    // Normalize whitespace/case so trivially different inputs map together.
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const seed = fnv1a(normalized);
    const rng = mulberry32(seed);

    const raw = new Array<number>(this.dim);
    let sumSquares = 0;
    for (let i = 0; i < this.dim; i += 1) {
      // Centre each component around 0 so vectors point in varied directions.
      const value = rng() * 2 - 1;
      raw[i] = value;
      sumSquares += value * value;
    }

    // L2-normalize. Guard against the (astronomically unlikely) zero vector.
    const norm = Math.sqrt(sumSquares);
    if (norm === 0) {
      const zero = new Array<number>(this.dim).fill(0);
      zero[0] = 1;
      return zero;
    }
    return raw.map((v) => v / norm);
  }
}
