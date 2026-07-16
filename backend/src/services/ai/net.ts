// Shared network resilience helpers for live AI provider adapters.
//
// Live LLM / embedding calls are wrapped with a hard timeout and a single
// retry (per design: "Provider calls wrapped with timeouts + one retry; on
// hard failure, jobs record failed_stage" — R2.6/R16.4). These helpers are
// intentionally dependency-free so both the Anthropic and OpenAI adapters can
// share identical resilience behaviour.

/** Default per-call timeout for a single network attempt (ms). */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Default number of retries after the first attempt (1 = two attempts total). */
export const DEFAULT_RETRIES = 1;
/** Base backoff before a retry (ms). */
const RETRY_BACKOFF_MS = 500;

/** Error thrown when a single attempt exceeds its timeout budget. */
export class ProviderTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms.`);
    this.name = 'ProviderTimeoutError';
  }
}

/** Reject if `promise` does not settle within `ms`. Never leaks the timer. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Options for {@link callWithResilience}. */
export interface ResilienceOptions {
  /** Human-readable label used in timeout / error messages. */
  label: string;
  /** Per-attempt timeout in ms (defaults to {@link DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Retries after the first attempt (defaults to {@link DEFAULT_RETRIES}). */
  retries?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run an async network task with a hard timeout and a small number of retries
 * using linear backoff. The last error is re-thrown after retries are spent so
 * the caller can record a failed stage.
 */
export async function callWithResilience<T>(
  task: () => Promise<T>,
  options: ResilienceOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(task(), timeoutMs, options.label);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(RETRY_BACKOFF_MS * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${options.label} failed: ${String(lastError)}`);
}
