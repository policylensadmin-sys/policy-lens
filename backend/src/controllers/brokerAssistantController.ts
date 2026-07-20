// Broker "Ask Lens" assistant controller — HTTP layer for
// `POST /api/broker/assistant` (R13).
//
// Lets a broker ask a free-text question and get an AI answer grounded in their
// own portfolio: recent categorized AI insights (`ai_insights`) plus a compact
// portfolio summary (policy volume, premium revenue, claims activity). The
// handler builds a provider-agnostic `ChunkContext[]` from those facts and
// delegates to the AI provider's `answerQuestion`, so it works identically with
// the live provider and the deterministic mock provider.
//
// Guarded upstream by `authMiddleware` + `rbacMiddleware('broker')` +
// `aiRateLimiter`, so `req.user` is an authenticated broker.

import type { RequestHandler } from 'express';

import type { ChunkContext } from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';
import { createAiProviders } from '../services/ai/factory';
import type { AIProvider } from '../services/ai/types';
import { InsightsService } from '../services/broker/insightsService';

/** Mirror the customer chat cap (R5.7): questions must be 1–500 chars. */
const MAX_QUESTION_LENGTH = 500;

/** Cap how many recent insights we fold into the grounding context. */
const MAX_INSIGHT_CONTEXT = 20;

/** Lazily-resolved shared service instance (defers Supabase client creation). */
const insightsService = new InsightsService();

/** Lazily-resolved AI provider (mock/live selected by the factory). */
let aiProviderSingleton: AIProvider | undefined;
function aiProvider(): AIProvider {
  if (!aiProviderSingleton) {
    aiProviderSingleton = createAiProviders({ silent: true }).ai;
  }
  return aiProviderSingleton;
}

/** A recent insight row used to build grounding context. */
interface RecentInsightRow {
  type: string | null;
  message: string | null;
}

/**
 * `POST /api/broker/assistant` — answer a broker's question grounded in their
 * portfolio. Body: `{ question: string }`. Responds `200` with the
 * {@link import('@policylens/shared').GroundedAnswer}
 * `{ answer, citedSections, groundedInPolicy }`.
 *
 * Rejects an empty or >500-char question with a `400` (R5.7). When the broker
 * has no data yet, the question is still answered against an empty context.
 */
export const askAssistant: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const rawQuestion = req.body?.question;
  if (typeof rawQuestion !== 'string') {
    next(AppError.badRequest('A question is required.'));
    return;
  }
  const question = rawQuestion.trim();
  if (question.length === 0) {
    next(AppError.badRequest('A question is required.'));
    return;
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    next(AppError.badRequest(`Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`));
    return;
  }

  void (async () => {
    const brokerId = await insightsService.resolveBrokerId(user.id);
    const context = await buildBrokerContext(brokerId);
    const answer = await aiProvider().answerQuestion(context, question);
    res.status(200).json(answer);
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to answer the question'));
  });
};

/**
 * Build the grounding context for a broker: recent AI insights (each becomes a
 * chunk keyed by its insight type) followed by compact portfolio facts (keyed
 * under the `portfolio` section). Returns an empty array when the broker has no
 * data, which the provider handles gracefully.
 */
async function buildBrokerContext(brokerId: string): Promise<ChunkContext[]> {
  const [insights, facts] = await Promise.all([
    fetchRecentInsights(brokerId),
    buildPortfolioFacts(brokerId),
  ]);

  const context: ChunkContext[] = [];
  let index = 0;

  for (const row of insights) {
    const content = (row.message ?? '').trim();
    if (content.length === 0) continue;
    context.push({
      chunkIndex: index++,
      content,
      section: (row.type ?? '').trim() || 'insight',
      similarity: 1,
    });
  }

  for (const fact of facts) {
    context.push({ chunkIndex: index++, content: fact, section: 'portfolio', similarity: 1 });
  }

  return context;
}

/** Load the broker's most recent AI insights for grounding (newest first). */
async function fetchRecentInsights(brokerId: string): Promise<RecentInsightRow[]> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .from('ai_insights')
    .select('type, message')
    .eq('broker_id', brokerId)
    .order('generated_at', { ascending: false, nullsFirst: false })
    .limit(MAX_INSIGHT_CONTEXT);

  if (error) {
    throw AppError.internal('Failed to load AI insights', { reason: error.message });
  }
  return (data as RecentInsightRow[] | null) ?? [];
}

/**
 * Derive a short, human-readable portfolio summary (policy volume, premium
 * revenue, claims activity, commission) via {@link InsightsService.getReports}.
 * Each returned string is a self-contained fact used as a grounding chunk.
 */
async function buildPortfolioFacts(brokerId: string): Promise<string[]> {
  const reports = await insightsService.getReports(brokerId);
  const { currency, policyVolume, premiumRevenue, claimsActivity, commission } = reports;

  const facts: string[] = [];

  facts.push(
    `Portfolio overview: ${policyVolume.total} total policies across the book, ` +
      `with total premium revenue of ${currency} ${premiumRevenue.total.toLocaleString('en-IN')}.`,
  );

  const byType = Object.entries(policyVolume.byType);
  if (byType.length > 0) {
    const mix = byType.map(([type, count]) => `${count} ${type}`).join(', ');
    facts.push(`Policy mix by insurance type: ${mix}.`);
  }

  const byStatus = Object.entries(policyVolume.byStatus);
  if (byStatus.length > 0) {
    const statuses = byStatus.map(([status, count]) => `${count} ${status}`).join(', ');
    facts.push(`Policies by status: ${statuses}.`);
  }

  facts.push(
    `Claims activity: ${claimsActivity.total} claims totalling ` +
      `${currency} ${claimsActivity.totalClaimedAmount.toLocaleString('en-IN')} claimed.`,
  );

  facts.push(
    `Commission: ${currency} ${commission.total.toLocaleString('en-IN')} earned in total, ` +
      `with ${currency} ${commission.pending.toLocaleString('en-IN')} pending.`,
  );

  return facts;
}
