// AI provider factory.
//
// Selects concrete AI, embedding, and OCR adapters from environment variables
// (`AI_PROVIDER`, `EMBEDDING_PROVIDER`, `OCR_PROVIDER`). When a selected
// provider is missing the credentials it needs, the factory transparently falls
// back to the deterministic mock adapter and logs a warning — this is the
// Demo/Mock mode that keeps the product runnable with zero external keys.
//
// On construction it logs a banner showing which providers are live vs mocked.

import { readAiEnv, type AiEnv } from '../../config/env';
// Real deterministic mock adapters (task 4.2).
import {
  createMockAIProvider,
  createMockEmbeddingProvider,
  createMockOCRProvider,
} from './mock';
// Real live LLM adapters (task 4.4).
import { createAnthropicAIProvider } from './anthropic';
import { createOpenAIAIProvider, createOpenAIEmbeddingProvider } from './openai';
// Live Google Vision OCR adapter (task 4.3).
import { createGoogleVisionOCRProvider } from './googleVision';
// Live OCR.space HTTP OCR adapter.
import { createOcrSpaceOCRProvider } from './ocrspace';
import type {
  AIProvider,
  AIProviderKind,
  AiProviders,
  EmbeddingProvider,
  EmbeddingProviderKind,
  OCRProvider,
  OCRProviderKind,
} from './types';

/** Minimal logger surface so callers can inject a structured logger later. */
export interface FactoryLogger {
  info(message: string): void;
  warn(message: string): void;
}

const defaultLogger: FactoryLogger = {
  // eslint-disable-next-line no-console
  info: (m) => console.log(m),
  // eslint-disable-next-line no-console
  warn: (m) => console.warn(m),
};

/** Records how a single provider slot was resolved, for the startup banner. */
interface Resolution<K extends string> {
  /** Provider that was requested via env. */
  requested: K;
  /** Provider actually used after credential checks. */
  effective: K;
  /** True when the effective provider is the mock adapter. */
  mocked: boolean;
  /** Populated when a fallback occurred, explaining why. */
  fallbackReason?: string;
}

function resolveAi(
  env: AiEnv,
  logger: FactoryLogger,
): { provider: AIProvider; resolution: Resolution<AIProviderKind> } {
  const requested = env.aiProvider;

  if (requested === 'anthropic') {
    if (env.anthropicApiKey) {
      return { provider: createAnthropicAIProvider(), resolution: mk(requested, requested, false) };
    }
    return fallbackAi(requested, 'ANTHROPIC_API_KEY is not set', logger);
  }

  if (requested === 'openai') {
    if (env.openaiApiKey) {
      return { provider: createOpenAIAIProvider(), resolution: mk(requested, requested, false) };
    }
    return fallbackAi(requested, 'OPENAI_API_KEY is not set', logger);
  }

  // requested === 'mock'
  return { provider: createMockAIProvider(), resolution: mk('mock', 'mock', true) };
}

function fallbackAi(
  requested: AIProviderKind,
  reason: string,
  logger: FactoryLogger,
): { provider: AIProvider; resolution: Resolution<AIProviderKind> } {
  logger.warn(`[ai] "${requested}" selected but ${reason}; falling back to mock adapter.`);
  return {
    provider: createMockAIProvider(),
    resolution: { requested, effective: 'mock', mocked: true, fallbackReason: reason },
  };
}

function resolveEmbedding(
  env: AiEnv,
  logger: FactoryLogger,
): { provider: EmbeddingProvider; resolution: Resolution<EmbeddingProviderKind> } {
  const requested = env.embeddingProvider;

  if (requested === 'openai') {
    if (env.openaiApiKey) {
      return {
        provider: createOpenAIEmbeddingProvider(env.embeddingDim),
        resolution: mk(requested, requested, false),
      };
    }
    const reason = 'OPENAI_API_KEY is not set';
    logger.warn(`[embedding] "openai" selected but ${reason}; falling back to mock adapter.`);
    return {
      provider: createMockEmbeddingProvider(env.embeddingDim),
      resolution: { requested, effective: 'mock', mocked: true, fallbackReason: reason },
    };
  }

  // requested === 'mock'
  return {
    provider: createMockEmbeddingProvider(env.embeddingDim),
    resolution: mk('mock', 'mock', true),
  };
}

function resolveOcr(
  env: AiEnv,
  logger: FactoryLogger,
): { provider: OCRProvider; resolution: Resolution<OCRProviderKind> } {
  const requested = env.ocrProvider;

  if (requested === 'ocrspace') {
    // OCR.space always has a usable key (falls back to the free demo key).
    return {
      provider: createOcrSpaceOCRProvider(),
      resolution: mk(requested, requested, false),
    };
  }

  if (requested === 'google') {
    if (env.googleVisionApiKey || env.googleApplicationCredentials) {
      return {
        provider: createGoogleVisionOCRProvider(),
        resolution: mk(requested, requested, false),
      };
    }
    const reason = 'neither GOOGLE_VISION_API_KEY nor GOOGLE_APPLICATION_CREDENTIALS is set';
    logger.warn(`[ocr] "google" selected but ${reason}; falling back to mock adapter.`);
    return {
      provider: createMockOCRProvider(),
      resolution: { requested, effective: 'mock', mocked: true, fallbackReason: reason },
    };
  }

  // requested === 'mock'
  return { provider: createMockOCRProvider(), resolution: mk('mock', 'mock', true) };
}

function mk<K extends string>(requested: K, effective: K, mocked: boolean): Resolution<K> {
  return { requested, effective, mocked };
}

function logBanner(
  logger: FactoryLogger,
  ai: Resolution<AIProviderKind>,
  embedding: Resolution<EmbeddingProviderKind>,
  ocr: Resolution<OCRProviderKind>,
): void {
  const badge = (r: Resolution<string>): string => (r.mocked ? 'MOCK' : 'LIVE');
  const line = (label: string, r: Resolution<string>): string =>
    `  ${label.padEnd(10)} ${badge(r).padEnd(5)} ${r.effective}` +
    (r.fallbackReason ? ` (requested "${r.requested}": ${r.fallbackReason})` : '');

  const anyMock = ai.mocked || embedding.mocked || ocr.mocked;
  logger.info('──────────────── PolicyLens AI providers ────────────────');
  logger.info(line('AI', ai));
  logger.info(line('Embedding', embedding));
  logger.info(line('OCR', ocr));
  if (anyMock) {
    logger.info('  Demo/Mock mode active — set provider keys to enable live providers.');
  }
  logger.info('──────────────────────────────────────────────────────────');
}

/** Options for {@link createAiProviders}. */
export interface CreateAiProvidersOptions {
  /** Override the environment (defaults to reading `process.env`). */
  env?: AiEnv;
  /** Override the logger (defaults to `console`). */
  logger?: FactoryLogger;
  /** Suppress the startup banner (defaults to `false`). */
  silent?: boolean;
}

/**
 * Build the AI, embedding, and OCR providers from configuration, applying
 * mock fallback when credentials are missing and logging a startup banner.
 */
export function createAiProviders(options: CreateAiProvidersOptions = {}): AiProviders {
  const env = options.env ?? readAiEnv();
  const logger = options.logger ?? defaultLogger;

  const ai = resolveAi(env, logger);
  const embedding = resolveEmbedding(env, logger);
  const ocr = resolveOcr(env, logger);

  if (!options.silent) {
    logBanner(logger, ai.resolution, embedding.resolution, ocr.resolution);
  }

  return { ai: ai.provider, embedding: embedding.provider, ocr: ocr.provider };
}
