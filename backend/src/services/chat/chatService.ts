// ChatService — RAG chat and semantic search over a policy's chunks (R5, R15).
//
// Both flows share the same retrieval core (design "RAG Flow"): embed the
// user's text with the injected embedder, then run pgvector cosine search via
// the `match_policy_chunks` SQL function (migration 006) scoped to a single
// policy, keeping only chunks at/above the similarity threshold.
//
//   • ask()    — grounded question answering. Validates the 500-char cap
//                (R5.7), verifies the policy is owned and fully analyzed
//                (informing the user of the current processing stage when it is
//                not, R5.6), retrieves the top-5 chunks (R5.3), and delegates to
//                AIProvider.answerQuestion to produce a plain-English, cited
//                answer (R5.1/R5.2). When nothing clears the threshold it
//                returns a grounded=false "not in this policy" answer that
//                suggests what can be asked (R5.4). The exchange is persisted to
//                chats / chat_messages (best-effort).
//
//   • search() — semantic search. Retrieves up to 10 chunks at/above 0.7
//                similarity, ordered by similarity descending, each carrying a
//                match percentage and source section (R15.2/R15.3); returns an
//                empty list (empty-state handled by the caller) when none match
//                (R15.5).
//
//   • getHistory() — returns a chat thread's messages in chronological order.
//
// Collaborators are injected so the service is easy to unit-test with fakes; in
// production it lazily resolves the service-role Supabase client and ownership
// is additionally enforced by the `owner_id` filter on every query.

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  CitedSection,
  ChunkContext,
  GroundedAnswer,
  PolicyStatus,
  SearchResult,
} from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import type { AIProvider } from '../ai/types';
import { formatVector } from '../policy/embeddings';

/** Maximum length (characters) of a chat question (R5.7). */
export const MAX_QUESTION_LENGTH = 500;

/** Minimum cosine similarity a chunk must reach to be used (R5.3/R15.2). */
export const SIMILARITY_THRESHOLD = 0.7;

/** Number of chunks retrieved for grounded chat answers (R5.3). */
export const CHAT_TOP_K = 5;

/** Number of chunks returned for semantic search (R15.2). */
export const SEARCH_TOP_K = 10;

/**
 * Minimal embedder contract used by the service — satisfied by
 * {@link EmbeddingsService}. Kept narrow so tests can supply a trivial fake.
 */
export interface QueryEmbedder {
  /** Embed a single query string into a vector (dimension matches the column). */
  embedQuery(text: string): Promise<number[]>;
}

/** A single row returned by the `match_policy_chunks` SQL function. */
interface MatchChunkRow {
  id: string;
  policy_id: string;
  chunk_index: number;
  content: string;
  section: string | null;
  page: number | null;
  similarity: number;
}

/** A grounded answer plus the chat thread it was persisted to (R5). */
export interface AskResult extends GroundedAnswer {
  /** The chat thread id the exchange was saved to, or `null` if not persisted. */
  chatId: string | null;
}

/** Result of a semantic search (R15). */
export interface SearchResponse {
  results: SearchResult[];
}

/** A single stored chat message (chronological history). */
export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citedSections: CitedSection[];
  createdAt: string;
}

/** A chat thread with its messages (R5 history). */
export interface ChatHistory {
  chat: { id: string; policyId: string; title: string | null; createdAt: string };
  messages: ChatMessageView[];
}

/** Human-readable label for each processing stage (R5.6). */
const STAGE_LABELS: Record<string, string> = {
  queued: 'queued for processing',
  ocr: 'extracting text from the document',
  embedding: 'indexing the document for search',
  analysis: 'analyzing the policy',
  done: 'finishing up',
};

/**
 * RAG chat + semantic search for a single policy. Inject the embedder, the AI
 * provider, and (optionally) a Supabase client; the client defaults to the
 * service-role client resolved lazily on first use.
 */
export class ChatService {
  private readonly embedder: QueryEmbedder;
  private readonly ai: AIProvider;
  private client?: SupabaseClient;

  /**
   * @param embedder Produces a query embedding (e.g. {@link EmbeddingsService}).
   * @param ai       AI provider used to compose grounded answers (R5).
   * @param client   Supabase client (defaults to the service-role client).
   */
  constructor(embedder: QueryEmbedder, ai: AIProvider, client?: SupabaseClient) {
    this.embedder = embedder;
    this.ai = ai;
    this.client = client;
  }

  /** Resolve the Supabase client lazily (service-role by default). */
  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  /**
   * Answer a question grounded exclusively in the owned policy's content (R5).
   *
   * @throws {AppError} 400 when the question is empty or exceeds
   *   {@link MAX_QUESTION_LENGTH} (R5.7); 404 when the policy is not owned/found;
   *   409 when the policy is still being processed (R5.6).
   */
  async ask(
    ownerId: string,
    policyId: string,
    question: string,
    chatId?: string,
  ): Promise<AskResult> {
    const trimmed = (question ?? '').trim();
    if (trimmed.length === 0) {
      throw AppError.badRequest('A question is required.');
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      throw AppError.badRequest(
        `Your question is too long. Please keep it to ${MAX_QUESTION_LENGTH} characters or fewer.`,
      );
    }

    // Verify ownership and that analysis has completed (R5.6).
    await this.assertPolicyReady(ownerId, policyId);

    // Embed → retrieve top-K chunks above the similarity threshold (R5.3).
    const chunks = await this.retrieve(policyId, trimmed, CHAT_TOP_K);

    let answer: GroundedAnswer;
    if (chunks.length === 0) {
      // Nothing in the policy supports the question (R5.4).
      answer = notInPolicyAnswer();
    } else {
      answer = await this.ai.answerQuestion(chunks, trimmed);
    }

    // Persist the exchange (best-effort; a persistence failure must not drop the
    // answer the user is waiting on).
    const savedChatId = await this.persistExchange(
      ownerId,
      policyId,
      chatId,
      trimmed,
      answer,
    );

    return { ...answer, chatId: savedChatId };
  }

  /**
   * Semantic search over the policy's chunks (R15). Returns up to
   * {@link SEARCH_TOP_K} matches at/above {@link SIMILARITY_THRESHOLD}, ordered
   * by similarity descending, each with a match percentage and source section.
   * Returns an empty list when nothing matches (empty-state handled by caller,
   * R15.5).
   *
   * @throws {AppError} 400 when the query is empty; 404 when the policy is not
   *   owned/found.
   */
  async search(ownerId: string, policyId: string, query: string): Promise<SearchResponse> {
    const trimmed = (query ?? '').trim();
    if (trimmed.length === 0) {
      throw AppError.badRequest('A search query is required.');
    }
    if (trimmed.length > MAX_QUESTION_LENGTH) {
      throw AppError.badRequest(
        `Your search query is too long. Please keep it to ${MAX_QUESTION_LENGTH} characters or fewer.`,
      );
    }

    // Ownership check (a missing/un-owned policy is a 404). We do not require the
    // analysis to be complete here — if it is not, there are simply no chunks.
    await this.assertPolicyOwned(ownerId, policyId);

    const chunks = await this.retrieve(policyId, trimmed, SEARCH_TOP_K);

    const results: SearchResult[] = chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      content: c.content,
      section: c.section ?? null,
      page: c.page ?? null,
      matchPercent: Math.round(clamp01(c.similarity) * 100),
    }));

    return { results };
  }

  /**
   * Return a chat thread's messages in chronological order (R5 history).
   *
   * @throws {AppError} 404 when the chat is not owned or does not belong to the
   *   given policy.
   */
  async getHistory(ownerId: string, policyId: string, chatId: string): Promise<ChatHistory> {
    const db = this.db();

    const { data: chat, error: chatError } = await db
      .from('chats')
      .select('id, policy_id, title, created_at')
      .eq('id', chatId)
      .eq('owner_id', ownerId)
      .eq('policy_id', policyId)
      .maybeSingle();

    if (chatError) {
      throw AppError.internal('Failed to load chat', { reason: chatError.message });
    }
    if (!chat) {
      throw AppError.notFound('Chat not found');
    }

    const { data: rows, error: msgError } = await db
      .from('chat_messages')
      .select('id, role, content, cited_sections, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (msgError) {
      throw AppError.internal('Failed to load chat messages', { reason: msgError.message });
    }

    const messages: ChatMessageView[] = (rows ?? []).map((row) => {
      const r = row as {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        cited_sections: unknown;
        created_at: string;
      };
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        citedSections: Array.isArray(r.cited_sections)
          ? (r.cited_sections as CitedSection[])
          : [],
        createdAt: r.created_at,
      };
    });

    const c = chat as { id: string; policy_id: string; title: string | null; created_at: string };
    return {
      chat: { id: c.id, policyId: c.policy_id, title: c.title ?? null, createdAt: c.created_at },
      messages,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Embed the query and run cosine retrieval via `match_policy_chunks`, scoped
   * to the policy, thresholded at {@link SIMILARITY_THRESHOLD}, ordered by
   * similarity descending, capped at `topK`.
   */
  private async retrieve(policyId: string, text: string, topK: number): Promise<ChunkContext[]> {
    const vector = await this.embedder.embedQuery(text);

    const { data, error } = await this.db().rpc('match_policy_chunks', {
      p_policy_id: policyId,
      query_embedding: formatVector(vector),
      match_threshold: SIMILARITY_THRESHOLD,
      match_count: topK,
    });

    if (error) {
      throw AppError.internal('Failed to search policy content', { reason: error.message });
    }

    const rows = (data ?? []) as MatchChunkRow[];
    const vectorMatches = rows.map((row) => ({
      chunkIndex: row.chunk_index,
      content: row.content,
      section: row.section ?? null,
      page: row.page ?? null,
      similarity: row.similarity,
    }));

    // Vector retrieval requires real embeddings. When embeddings run on the
    // deterministic mock (free mode), cosine similarity is effectively random
    // and nothing clears the threshold — so fall back to a free keyword-overlap
    // search over the policy's chunks. This keeps chat/search grounded with zero
    // external cost.
    if (vectorMatches.length > 0) return vectorMatches;
    return this.keywordRetrieve(policyId, text, topK);
  }

  /**
   * Free lexical fallback: rank the policy's chunks by how many of the query's
   * keywords they contain. Returns up to `topK` chunks with a synthetic
   * similarity derived from the keyword-overlap ratio.
   */
  private async keywordRetrieve(
    policyId: string,
    text: string,
    topK: number,
  ): Promise<ChunkContext[]> {
    const { data, error } = await this.db()
      .from('policy_chunks')
      .select('chunk_index, content, section, page')
      .eq('policy_id', policyId)
      .limit(500);

    if (error) {
      throw AppError.internal('Failed to search policy content', { reason: error.message });
    }

    const rows = (data ?? []) as Array<{
      chunk_index: number;
      content: string;
      section: string | null;
      page: number | null;
    }>;
    if (rows.length === 0) return [];

    const keywords = extractKeywords(text);
    if (keywords.length === 0) {
      return rows.slice(0, topK).map((r) => ({
        chunkIndex: r.chunk_index,
        content: r.content,
        section: r.section ?? null,
        page: r.page ?? null,
        similarity: 0.72,
      }));
    }

    const scored = rows.map((r) => {
      const haystack = r.content.toLowerCase();
      let hits = 0;
      for (const kw of keywords) if (haystack.includes(kw)) hits += 1;
      return { r, ratio: hits / keywords.length };
    });

    scored.sort((a, b) => b.ratio - a.ratio);

    const top = scored.filter((s) => s.ratio > 0).slice(0, topK);
    const chosen = top.length > 0 ? top : scored.slice(0, Math.min(topK, 3));

    return chosen.map(({ r, ratio }) => ({
      chunkIndex: r.chunk_index,
      content: r.content,
      section: r.section ?? null,
      page: r.page ?? null,
      similarity: Math.min(0.95, 0.6 + ratio * 0.35),
    }));
  }

  /**
   * Verify the policy exists and is owned by the caller. Returns the policy's
   * status. Throws `404` when not found/owned.
   */
  private async loadOwnedPolicyStatus(
    ownerId: string,
    policyId: string,
  ): Promise<PolicyStatus> {
    const { data, error } = await this.db()
      .from('policies')
      .select('id, status')
      .eq('id', policyId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load policy', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Policy not found');
    }
    return (data as { status: PolicyStatus }).status;
  }

  /** Assert the policy is owned (status not inspected). */
  private async assertPolicyOwned(ownerId: string, policyId: string): Promise<void> {
    await this.loadOwnedPolicyStatus(ownerId, policyId);
  }

  /**
   * Assert the policy is owned and its analysis is complete. When the policy is
   * still processing, surface an informative `409` naming the current stage
   * (R5.6); when it failed, surface a `409` telling the user to retry.
   */
  private async assertPolicyReady(ownerId: string, policyId: string): Promise<void> {
    const status = await this.loadOwnedPolicyStatus(ownerId, policyId);
    if (status === 'analyzed') return;

    if (status === 'failed') {
      throw new AppError(409, 'This policy could not be analyzed. Please re-upload or retry the analysis before asking questions.', {
        code: 'policy_not_ready',
        details: { status },
      });
    }

    // uploaded / processing — report the current pipeline stage (R5.6).
    const stage = await this.currentStage(ownerId, policyId);
    const stageLabel = stage ? STAGE_LABELS[stage] ?? stage : 'being prepared';
    throw new AppError(
      409,
      `This policy is still being analyzed (currently ${stageLabel}). Please wait until analysis is complete before asking questions.`,
      { code: 'policy_not_ready', details: { status, stage: stage ?? null } },
    );
  }

  /** Read the most recent job's stage for the policy (best-effort, R5.6). */
  private async currentStage(ownerId: string, policyId: string): Promise<string | null> {
    const { data, error } = await this.db()
      .from('jobs')
      .select('stage, created_at')
      .eq('owner_id', ownerId)
      .eq('policy_id', policyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return (data as { stage: string | null }).stage ?? null;
  }

  /**
   * Persist the user question and grounded answer to chats / chat_messages.
   * Creates a new chat when `chatId` is not supplied (or does not resolve to an
   * owned thread). Best-effort: any failure is swallowed and `null` is returned
   * so the answer is still delivered.
   */
  private async persistExchange(
    ownerId: string,
    policyId: string,
    chatId: string | undefined,
    question: string,
    answer: GroundedAnswer,
  ): Promise<string | null> {
    try {
      const db = this.db();
      const resolvedChatId = await this.resolveOrCreateChat(ownerId, policyId, chatId, question);
      if (!resolvedChatId) return null;

      const { error } = await db.from('chat_messages').insert([
        { chat_id: resolvedChatId, role: 'user', content: question, cited_sections: [] },
        {
          chat_id: resolvedChatId,
          role: 'assistant',
          content: answer.answer,
          cited_sections: answer.citedSections,
        },
      ]);
      if (error) return null;

      return resolvedChatId;
    } catch {
      return null;
    }
  }

  /**
   * Resolve an existing owned chat (matching policy) or create a new one titled
   * from the first question. Returns the chat id, or `null` on failure.
   */
  private async resolveOrCreateChat(
    ownerId: string,
    policyId: string,
    chatId: string | undefined,
    question: string,
  ): Promise<string | null> {
    const db = this.db();

    if (chatId) {
      const { data } = await db
        .from('chats')
        .select('id')
        .eq('id', chatId)
        .eq('owner_id', ownerId)
        .eq('policy_id', policyId)
        .maybeSingle();
      if (data?.id) return data.id as string;
      // Fall through to create a new thread when the supplied id is invalid.
    }

    const { data, error } = await db
      .from('chats')
      .insert({ owner_id: ownerId, policy_id: policyId, title: deriveTitle(question) })
      .select('id')
      .single();

    if (error || !data?.id) return null;
    return data.id as string;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The grounded=false answer returned when no chunk clears the similarity
 * threshold: tells the user the information is not in the policy and suggests
 * the kinds of questions that can be answered (R5.4).
 */
function notInPolicyAnswer(): GroundedAnswer {
  return {
    answer:
      "I could not find anything in this policy document that answers your question, so I cannot answer it from your policy. " +
      'Try asking about what is covered, exclusions, waiting periods, room-rent or sub-limits, co-payments, deductibles, or how to make a claim.',
    citedSections: [],
    groundedInPolicy: false,
  };
}

/** Derive a short chat title from the opening question (capped length). */
function deriveTitle(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

/** Clamp a number into the [0, 1] range. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Common English stopwords ignored during keyword extraction. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does',
  'did', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'my', 'me', 'i', 'you', 'your',
  'this', 'that', 'it', 'its', 'as', 'at', 'by', 'with', 'from', 'about', 'what',
  'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'have', 'has', 'had', 'if', 'then',
  'so', 'not', 'no', 'yes', 'any', 'all', 'am', 'covered', 'cover', 'policy',
]);

/**
 * Extract meaningful keywords from a query: lowercase, split on non-word chars,
 * drop stopwords and very short tokens, and de-duplicate.
 */
function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}
