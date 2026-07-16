// Shared strict-JSON AIProvider implementation.
//
// Both the Anthropic and OpenAI adapters ask their model for strict JSON and
// then parse + validate it with Zod. The only real difference is transport, so
// the parsing / repair-retry / fallback logic lives here once. A concrete
// adapter supplies an {@link LlmChatClient}; this class turns it into a full
// {@link AIProvider}.
//
// Repair strategy (R3.10): on the first parse/validation failure we send ONE
// repair turn echoing the bad output and the validation error, then re-parse.
// If that still fails the error propagates so callers can fall back to a
// partial analysis / failed stage.

import type { z, ZodTypeAny } from 'zod';
import type {
  ChunkContext,
  ClaimResult,
  ComparisonResult,
  GroundedAnswer,
  Insight,
  PolicyAnalysis,
  PortfolioSummary,
} from '@policylens/shared';
import { PolicyAnalysisSchema } from '@policylens/shared';
import type { AIProvider } from './types';
import {
  ANALYZE_SYSTEM,
  ANSWER_SYSTEM,
  CLAIM_SYSTEM,
  COMPARE_SYSTEM,
  INSIGHTS_SYSTEM,
  buildAnalyzeUser,
  buildAnswerUser,
  buildClaimUser,
  buildCompareUser,
  buildInsightsUser,
  buildRepairUser,
} from './prompts';
import {
  ClaimResultSchema,
  ComparisonResultSchema,
  GroundedAnswerSchema,
  InsightListSchema,
} from './schemas';

/** A single chat turn passed to the underlying model. */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Transport abstraction implemented by each concrete provider adapter. */
export interface LlmChatClient {
  /** Provider label used in errors/logging (e.g. `"anthropic"`). */
  readonly name: string;
  /** Send messages and return the model's raw text response (expected JSON). */
  complete(messages: LlmMessage[]): Promise<string>;
}

/** Error thrown when the model output cannot be parsed even after repair. */
export class StructuredOutputError extends Error {
  constructor(
    provider: string,
    operation: string,
    public readonly detail: string,
  ) {
    super(`[${provider}] ${operation} returned unparseable output: ${detail}`);
    this.name = 'StructuredOutputError';
  }
}

/**
 * Strip markdown code fences and isolate the first JSON value in a string, so
 * minor formatting slips (```json fences, leading prose) still parse.
 */
export function extractJson(raw: string): string {
  let s = raw.trim();
  // Remove a leading ```json / ``` fence and a trailing ``` fence if present.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence && fence[1] !== undefined) {
    s = fence[1].trim();
  }
  // Otherwise, slice from the first { or [ to the matching last } or ].
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const lastObj = s.lastIndexOf('}');
    const lastArr = s.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);
    if (end > start) {
      s = s.slice(start, end + 1);
    }
  }
  return s;
}

/** Concrete AIProvider driven by a transport-specific {@link LlmChatClient}. */
export class StructuredAIProvider implements AIProvider {
  constructor(private readonly client: LlmChatClient) {}

  async analyzePolicy(text: string): Promise<PolicyAnalysis> {
    const analysis = await this.runJson(
      'analyzePolicy',
      PolicyAnalysisSchema,
      ANALYZE_SYSTEM,
      buildAnalyzeUser(text),
    );
    return finalizeAnalysis(analysis);
  }

  answerQuestion(ctx: ChunkContext[], q: string): Promise<GroundedAnswer> {
    return this.runJson('answerQuestion', GroundedAnswerSchema, ANSWER_SYSTEM, buildAnswerUser(ctx, q));
  }

  comparePolicies(a: PolicyAnalysis, b: PolicyAnalysis): Promise<ComparisonResult> {
    return this.runJson(
      'comparePolicies',
      ComparisonResultSchema,
      COMPARE_SYSTEM,
      buildCompareUser(a, b),
    );
  }

  simulateClaim(analysis: PolicyAnalysis, scenario: string): Promise<ClaimResult> {
    return this.runJson(
      'simulateClaim',
      ClaimResultSchema,
      CLAIM_SYSTEM,
      buildClaimUser(analysis, scenario),
    );
  }

  async brokerInsights(portfolio: PortfolioSummary): Promise<Insight[]> {
    const { insights } = await this.runJson(
      'brokerInsights',
      InsightListSchema,
      INSIGHTS_SYSTEM,
      buildInsightsUser(portfolio),
    );
    const generatedAt = new Date().toISOString();
    // Keep only clientIds that exist in the portfolio; stamp generation time.
    const known = new Set(portfolio.policies.map((p) => p.clientId));
    return insights.map((i) => ({
      type: i.type,
      message: i.message,
      clientIds: i.clientIds.filter((id) => known.has(id)),
      evidence: i.evidence,
      generatedAt,
    }));
  }

  /**
   * Send a structured prompt, parse with `schema`, and on failure send a single
   * repair turn before giving up (R3.10).
   */
  private async runJson<S extends ZodTypeAny>(
    operation: string,
    schema: S,
    system: string,
    user: string,
  ): Promise<z.infer<S>> {
    const messages: LlmMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const raw = await this.client.complete(messages);
    const first = tryParse(schema, raw);
    if (first.ok) return first.value;

    // One repair retry — echo the bad output and the validation error.
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRepairUser(first.error) });

    const repaired = await this.client.complete(messages);
    const second = tryParse(schema, repaired);
    if (second.ok) return second.value;

    throw new StructuredOutputError(this.client.name, operation, second.error);
  }
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse JSON text and validate against a schema without throwing. */
function tryParse<S extends ZodTypeAny>(schema: S, raw: string): ParseResult<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.message };
}

/**
 * Derive `riskFlagCount` deterministically from the validated analysis (count
 * of Medium/High hidden clauses), matching the mock/pipeline behaviour (R3.8).
 * The health score itself is computed by a dedicated downstream step.
 */
function finalizeAnalysis(analysis: PolicyAnalysis): PolicyAnalysis {
  const riskFlagCount = analysis.hiddenClauses.filter(
    (c) => c.risk === 'High' || c.risk === 'Medium',
  ).length;
  return { ...analysis, riskFlagCount };
}
