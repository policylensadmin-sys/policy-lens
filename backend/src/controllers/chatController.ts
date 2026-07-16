// Chat controller — HTTP layer for RAG chat and semantic search (R5, R15).
//
// Endpoints:
//   POST /api/policies/:id/chat          — ask a question grounded in the policy (R5).
//   POST /api/policies/:id/search        — semantic search over the policy (R15).
//   GET  /api/policies/:id/chat/:chatId  — chat message history (R5).
//
// Each handler resolves the caller's profile id (the `owner_id` that domain
// rows reference) from their auth user id, then delegates to {@link ChatService}
// which enforces ownership, the 500-char question cap (R5.7), and the
// still-processing guard (R5.6). Errors bubble to the central error handler as
// the shared `{ error: { code, message } }` shape.

import type { RequestHandler } from 'express';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';
import { createAiProviders } from '../services/ai/factory';
import { ChatService } from '../services/chat/chatService';
import { EmbeddingsService } from '../services/policy/embeddings';

/**
 * Build the shared {@link ChatService} lazily on first use. Provider resolution
 * (and any Supabase client creation) is deferred so importing this module does
 * not require credentials in mock/dev mode.
 */
let chatServiceSingleton: ChatService | undefined;
function chatService(): ChatService {
  if (!chatServiceSingleton) {
    const { ai, embedding } = createAiProviders({ silent: true });
    const embedder = new EmbeddingsService(embedding);
    chatServiceSingleton = new ChatService(embedder, ai);
  }
  return chatServiceSingleton;
}

/**
 * Resolve the caller's profile id (`profiles.id`) from their auth user id
 * (`profiles.user_id`). Domain rows scope ownership by profile id, whereas
 * `req.user.id` is the Supabase auth user id.
 */
async function resolveProfileId(userId: string): Promise<string> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.id) {
    throw AppError.unauthorized('No profile found for the authenticated user');
  }
  return data.id as string;
}

/** Read a required string field from the request body, or `undefined`. */
function bodyString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `POST /api/policies/:id/chat` — ask a grounded question about the policy.
 * Responds `200` with `{ answer, citedSections, groundedInPolicy, chatId }`
 * (R5.1/R5.2/R5.4). Rejects questions over 500 chars (R5.7) and policies still
 * processing (R5.6).
 */
export const askQuestion: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const policyId = req.params.id;
  if (!policyId) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }

  const question = bodyString(req.body?.question);
  if (question === undefined) {
    next(AppError.badRequest('A question is required.'));
    return;
  }

  const chatId = bodyString(req.body?.chatId);

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const result = await chatService().ask(ownerId, policyId, question, chatId);
    res.status(200).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to answer the question'));
  });
};

/**
 * `POST /api/policies/:id/search` — semantic search over the policy's clauses.
 * Responds `200` with `{ results }` ordered by match descending (R15.2/R15.3);
 * an empty `results` array signals the no-match empty-state (R15.5).
 */
export const searchPolicy: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const policyId = req.params.id;
  if (!policyId) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }

  const query = bodyString(req.body?.query);
  if (query === undefined) {
    next(AppError.badRequest('A search query is required.'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const result = await chatService().search(ownerId, policyId, query);
    res.status(200).json(result);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to search the policy'));
  });
};

/**
 * `GET /api/policies/:id/chat/:chatId` — chat message history for a thread.
 * Responds `200` with `{ chat, messages }` in chronological order (R5).
 */
export const getChatHistory: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const policyId = req.params.id;
  const chatId = req.params.chatId;
  if (!policyId) {
    next(AppError.badRequest('Missing policy id'));
    return;
  }
  if (!chatId) {
    next(AppError.badRequest('Missing chat id'));
    return;
  }

  void (async () => {
    const ownerId = await resolveProfileId(user.id);
    const history = await chatService().getHistory(ownerId, policyId, chatId);
    res.status(200).json(history);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to load chat history'));
  });
};
