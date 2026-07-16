import { describe, expect, it } from 'vitest';
import { createAiProviders, type FactoryLogger } from '../src/services/ai/factory';
import type { AiEnv } from '../src/config/env';
import { MockAIProvider, MockEmbeddingProvider, MockOCRProvider } from '../src/services/ai/mock';

// Unit tests for the AI provider factory's mock-fallback behavior (task 4.5).
//
// These tests exercise createAiProviders through its `env` and `logger`
// injection options so nothing touches process.env or the network. A captured
// logger records the startup banner and any fallback warnings, and the returned
// providers are asserted to be the deterministic mock adapters.
//
// Requirements: 3.1 (Demo/Mock mode with zero external keys), 15.1 (embeddings).

/** Build a full AiEnv with sensible mock defaults, overridable per test. */
function makeEnv(overrides: Partial<AiEnv> = {}): AiEnv {
  return {
    aiProvider: 'mock',
    embeddingProvider: 'mock',
    ocrProvider: 'mock',
    embeddingDim: 1536,
    ...overrides,
  };
}

/** A logger that records every info/warn message for later assertions. */
function makeCapturingLogger(): FactoryLogger & { infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    infos,
    warns,
    info: (m: string) => infos.push(m),
    warn: (m: string) => warns.push(m),
  };
}

describe('createAiProviders — mock fallback', () => {
  it('returns mock adapters when providers are set to mock (default)', () => {
    const logger = makeCapturingLogger();
    const providers = createAiProviders({ env: makeEnv(), logger });

    expect(providers.ai).toBeInstanceOf(MockAIProvider);
    expect(providers.embedding).toBeInstanceOf(MockEmbeddingProvider);
    expect(providers.ocr).toBeInstanceOf(MockOCRProvider);

    // No credentials missing → no fallback warnings.
    expect(logger.warns).toHaveLength(0);

    // The startup banner announces Demo/Mock mode.
    const banner = logger.infos.join('\n');
    expect(banner).toContain('PolicyLens AI providers');
    expect(banner).toContain('Demo/Mock mode active');
  });

  it('mock AI provider behaves deterministically without network access', async () => {
    const providers = createAiProviders({ env: makeEnv(), logger: makeCapturingLogger(), silent: true });

    const first = await providers.ai.analyzePolicy('Comprehensive health insurance policy wording.');
    const second = await providers.ai.analyzePolicy('Comprehensive health insurance policy wording.');

    // Deterministic: identical input yields identical analysis.
    expect(first).toEqual(second);
    expect(first.healthScore).toBeTypeOf('number');
    expect(Array.isArray(first.exclusions)).toBe(true);
  });

  it('falls back to mock and warns when AI_PROVIDER=anthropic but the key is absent', () => {
    const logger = makeCapturingLogger();
    const providers = createAiProviders({
      env: makeEnv({ aiProvider: 'anthropic' }),
      logger,
    });

    expect(providers.ai).toBeInstanceOf(MockAIProvider);
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toContain('[ai]');
    expect(logger.warns[0]).toContain('anthropic');
    expect(logger.warns[0]).toContain('ANTHROPIC_API_KEY');
    expect(logger.warns[0]).toContain('falling back to mock');
  });

  it('falls back to mock and warns when AI_PROVIDER=openai but the key is absent', () => {
    const logger = makeCapturingLogger();
    const providers = createAiProviders({
      env: makeEnv({ aiProvider: 'openai' }),
      logger,
    });

    expect(providers.ai).toBeInstanceOf(MockAIProvider);
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toContain('[ai]');
    expect(logger.warns[0]).toContain('OPENAI_API_KEY');
    expect(logger.warns[0]).toContain('falling back to mock');
  });

  it('falls back to mock embedding and warns when EMBEDDING_PROVIDER=openai without the key', () => {
    const logger = makeCapturingLogger();
    const providers = createAiProviders({
      env: makeEnv({ embeddingProvider: 'openai' }),
      logger,
    });

    expect(providers.embedding).toBeInstanceOf(MockEmbeddingProvider);
    expect(providers.embedding.dim).toBe(1536);
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toContain('[embedding]');
    expect(logger.warns[0]).toContain('OPENAI_API_KEY');
    expect(logger.warns[0]).toContain('falling back to mock');
  });

  it('falls back to mock OCR and warns when OCR_PROVIDER=google without any Google credentials', () => {
    const logger = makeCapturingLogger();
    const providers = createAiProviders({
      env: makeEnv({ ocrProvider: 'google' }),
      logger,
    });

    expect(providers.ocr).toBeInstanceOf(MockOCRProvider);
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toContain('[ocr]');
    expect(logger.warns[0]).toContain('GOOGLE_VISION_API_KEY');
    expect(logger.warns[0]).toContain('GOOGLE_APPLICATION_CREDENTIALS');
    expect(logger.warns[0]).toContain('falling back to mock');
  });

  it('honors explicit mock selections without any warnings', () => {
    const logger = makeCapturingLogger();
    const providers = createAiProviders({
      env: makeEnv({ aiProvider: 'mock', embeddingProvider: 'mock', ocrProvider: 'mock' }),
      logger,
    });

    expect(providers.ai).toBeInstanceOf(MockAIProvider);
    expect(providers.embedding).toBeInstanceOf(MockEmbeddingProvider);
    expect(providers.ocr).toBeInstanceOf(MockOCRProvider);
    expect(logger.warns).toHaveLength(0);
  });

  it('does not emit the banner when silent is true', () => {
    const logger = makeCapturingLogger();
    createAiProviders({ env: makeEnv(), logger, silent: true });

    expect(logger.infos).toHaveLength(0);
  });
});
