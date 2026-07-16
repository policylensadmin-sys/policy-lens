// Anthropic (Claude) AI provider adapter (R3, R5, R7, R8, R13).
//
// Wraps the official @anthropic-ai/sdk in the shared strict-JSON pipeline
// (see `structured.ts`). Anthropic has a dedicated `system` parameter rather
// than a system message role, so this client hoists any system turns into that
// field and passes the remaining user/assistant turns as `messages`. All calls
// go through `callWithResilience` for timeout + one retry.

import Anthropic from '@anthropic-ai/sdk';
import { readAiEnv } from '../../config/env';
import { callWithResilience } from './net';
import { StructuredAIProvider, type LlmChatClient, type LlmMessage } from './structured';
import type { AIProvider } from './types';

/** Default Claude model when `ANTHROPIC_MODEL` is not set. */
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
/** Max tokens for a structured JSON response. */
const MAX_TOKENS = 4096;

/** Transport client backed by the Anthropic Messages API. */
class AnthropicChatClient implements LlmChatClient {
  readonly name = 'anthropic';

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async complete(messages: LlmMessage[]): Promise<string> {
    // Anthropic keeps `system` separate from the conversation turns.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await callWithResilience(
      () =>
        this.client.messages.create({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: turns,
        }),
      { label: 'anthropic.messages.create' },
    );

    // Concatenate all text blocks from the response content.
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}

/**
 * Build the live Anthropic AI provider. Reads `ANTHROPIC_API_KEY` and
 * `ANTHROPIC_MODEL` from the environment; the factory only selects this adapter
 * when the API key is present.
 */
export function createAnthropicAIProvider(): AIProvider {
  const env = readAiEnv();
  const apiKey = env.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('createAnthropicAIProvider: ANTHROPIC_API_KEY is not set.');
  }
  const model = env.anthropicModel ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  return new StructuredAIProvider(new AnthropicChatClient(client, model));
}

export { AnthropicChatClient };
