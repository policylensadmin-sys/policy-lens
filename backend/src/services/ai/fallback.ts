// FallbackAIProvider — resilient primary→secondary AI wrapper.
//
// Wraps two AIProviders: it tries the `primary` (e.g. Gemini) for each call and,
// if that throws (rate limit / 429, transient 5xx, network), transparently
// retries the same call on the `secondary` (e.g. Groq/OpenAI, or the mock).
// This keeps the product working even when the primary provider's free-tier
// quota is exhausted, while still preferring the primary whenever it succeeds.

import type {
  ChunkContext,
  ClaimResult,
  ComparisonResult,
  GroundedAnswer,
  Insight,
  PolicyAnalysis,
  PortfolioSummary,
} from '@policylens/shared';

import type { AIProvider, EmbeddingProvider } from './types';

/** Minimal logger surface (matches the factory's). */
interface FallbackLogger {
  warn(message: string): void;
}

/** An AIProvider that falls back from `primary` to `secondary` on any error. */
export class FallbackAIProvider implements AIProvider {
  constructor(
    private readonly primary: AIProvider,
    private readonly secondary: AIProvider,
    private readonly primaryName: string,
    private readonly secondaryName: string,
    private readonly logger?: FallbackLogger,
  ) {}

  private async run<T>(op: string, fn: (p: AIProvider) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (err) {
      this.logger?.warn(
        `[ai] ${this.primaryName} failed for ${op} (${describe(err)}); ` +
          `falling back to ${this.secondaryName}.`,
      );
      return fn(this.secondary);
    }
  }

  analyzePolicy(text: string): Promise<PolicyAnalysis> {
    return this.run('analyzePolicy', (p) => p.analyzePolicy(text));
  }
  answerQuestion(ctx: ChunkContext[], q: string): Promise<GroundedAnswer> {
    return this.run('answerQuestion', (p) => p.answerQuestion(ctx, q));
  }
  comparePolicies(a: PolicyAnalysis, b: PolicyAnalysis): Promise<ComparisonResult> {
    return this.run('comparePolicies', (p) => p.comparePolicies(a, b));
  }
  simulateClaim(analysis: PolicyAnalysis, scenario: string): Promise<ClaimResult> {
    return this.run('simulateClaim', (p) => p.simulateClaim(analysis, scenario));
  }
  brokerInsights(portfolio: PortfolioSummary): Promise<Insight[]> {
    return this.run('brokerInsights', (p) => p.brokerInsights(portfolio));
  }
}

/**
 * An EmbeddingProvider that falls back from `primary` to `secondary` on error,
 * per batch (so every vector in a batch comes from the same provider). Both
 * providers must share the same `dim` so stored vectors stay consistent.
 */
export class FallbackEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;

  constructor(
    private readonly primary: EmbeddingProvider,
    private readonly secondary: EmbeddingProvider,
    private readonly primaryName: string,
    private readonly secondaryName: string,
    private readonly logger?: FallbackLogger,
  ) {
    this.dim = primary.dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    try {
      return await this.primary.embed(texts);
    } catch (err) {
      this.logger?.warn(
        `[embedding] ${this.primaryName} failed (${describe(err)}); ` +
          `falling back to ${this.secondaryName}.`,
      );
      return this.secondary.embed(texts);
    }
  }
}

/** Best-effort human-readable description of a thrown value. */
function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}
