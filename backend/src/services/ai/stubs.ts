// Shared error for not-yet-implemented provider adapters.
//
// All provider adapters are now real:
//   - Mock adapters ............. task 4.2 (see `./mock`)
//   - Google Vision OCR ......... task 4.3 (see `./googleVision`)
//   - Anthropic / OpenAI ........ task 4.4 (see `./anthropic`, `./openai`)
//
// This module retains `ProviderNotImplementedError` — re-exported by
// `index.ts` — so future stubbed adapters (or defensive code paths) can fail
// loudly rather than silently.

/** Error thrown when a not-yet-implemented adapter is invoked. */
export class ProviderNotImplementedError extends Error {
  constructor(provider: string, task: string) {
    super(`AI provider "${provider}" is not implemented yet (see task ${task}).`);
    this.name = 'ProviderNotImplementedError';
  }
}
