// Typed environment accessor for the backend.
//
// A minimal, dependency-free reader over `process.env` used by the AI provider
// factory (and future services) to select adapters and read credentials. This
// keeps env access in one place so it can later be swapped for a validated
// config loader (task 3.1) without touching call sites.

import type { AIProviderKind, EmbeddingProviderKind, OCRProviderKind } from '../services/ai/types';

/** Read a trimmed, non-empty string env var, or `undefined` when absent/blank. */
function str(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read an integer env var, falling back to `fallback` when unset/invalid. */
function int(name: string, fallback: number): number {
  const raw = str(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalize a provider-selection env var to a known kind. Unknown/blank values
 * resolve to `mock` so the product always has a working default (Demo/Mock mode).
 */
function selection<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = str(name)?.toLowerCase();
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

const AI_PROVIDER_KINDS = ['anthropic', 'openai', 'mock'] as const;
const EMBEDDING_PROVIDER_KINDS = ['openai', 'mock'] as const;
const OCR_PROVIDER_KINDS = ['google', 'ocrspace', 'mock'] as const;

/** Provider selection + credentials read from the environment. */
export interface AiEnv {
  aiProvider: AIProviderKind;
  embeddingProvider: EmbeddingProviderKind;
  ocrProvider: OCRProviderKind;

  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  /** Optional custom OpenAI-compatible base URL (e.g. Groq, Together, local). */
  openaiBaseUrl?: string;

  embeddingModel?: string;
  embeddingDim: number;

  googleVisionApiKey?: string;
  googleApplicationCredentials?: string;
  /** OCR.space API key (HTTP OCR). Falls back to the free public demo key. */
  ocrSpaceApiKey?: string;
}

/**
 * Read AI-related environment variables. Called lazily by the factory so tests
 * can mutate `process.env` before construction.
 */
export function readAiEnv(): AiEnv {
  return {
    aiProvider: selection('AI_PROVIDER', AI_PROVIDER_KINDS, 'mock'),
    embeddingProvider: selection('EMBEDDING_PROVIDER', EMBEDDING_PROVIDER_KINDS, 'mock'),
    ocrProvider: selection('OCR_PROVIDER', OCR_PROVIDER_KINDS, 'mock'),

    anthropicApiKey: str('ANTHROPIC_API_KEY'),
    anthropicModel: str('ANTHROPIC_MODEL'),
    openaiApiKey: str('OPENAI_API_KEY'),
    openaiModel: str('OPENAI_MODEL'),
    openaiBaseUrl: str('OPENAI_BASE_URL'),

    embeddingModel: str('EMBEDDING_MODEL'),
    embeddingDim: int('EMBEDDING_DIM', 1536),

    googleVisionApiKey: str('GOOGLE_VISION_API_KEY'),
    googleApplicationCredentials: str('GOOGLE_APPLICATION_CREDENTIALS'),
    ocrSpaceApiKey: str('OCRSPACE_API_KEY'),
  };
}
