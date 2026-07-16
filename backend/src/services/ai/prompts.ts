// Prompt library for the live AI adapters.
//
// All prompts live here as named constants / builders so they are easy to
// tune and review in one place, and so the Anthropic and OpenAI adapters share
// identical instructions (only the transport differs). Every prompt insists on
// STRICT JSON output: a single JSON value, no prose, no markdown fences.

import type {
  ChunkContext,
  PolicyAnalysis,
  PortfolioSummary,
} from '@policylens/shared';

/** Shared preamble reused by every structured prompt. */
const JSON_ONLY =
  'You are PolicyLens, an expert insurance-policy analyst. ' +
  'Respond with a SINGLE valid JSON value only — no prose, no explanation, ' +
  'and no markdown code fences. Do not wrap the JSON in ```. ' +
  'Use INR as the default currency and keep every explanation under 100 words.';

// ---------------------------------------------------------------------------
// analyzePolicy (R3)
// ---------------------------------------------------------------------------

/** System prompt for structured policy analysis. */
export const ANALYZE_SYSTEM =
  `${JSON_ONLY}\n\n` +
  'Extract a structured analysis of the insurance policy text. Return JSON with ' +
  'exactly these keys:\n' +
  '{\n' +
  '  "category": "health|life|motor|travel|home" (optional),\n' +
  '  "provider": string,\n' +
  '  "premium": { "amount": number, "currency": "INR" },\n' +
  '  "sumInsured": number,\n' +
  '  "coverage": [{ "type": string, "detail": string, "covered": boolean }],\n' +
  '  "exclusions": [{ "name": string, "explanation": string }],\n' +
  '  "waitingPeriods": [{ "duration": string, "appliesTo": string }],\n' +
  '  "financialLimits": [{ "name": string, "value": number, "unit": string (optional) }],\n' +
  '  "coPay": [{ "percent": number, "condition": string (optional) }],\n' +
  '  "deductibles": [{ "amount": number }],\n' +
  '  "hiddenClauses": [{ "clause": string, "risk": "High|Medium|Low", "impact": string }],\n' +
  '  "recommendations": [{ "kind": "gap|risk", "title": string, "detail": string }],\n' +
  '  "notFound": [string]\n' +
  '}\n' +
  'Rules: If a category of information is entirely absent from the document, add ' +
  'its key name (e.g. "exclusions") to the "notFound" array and return an empty ' +
  'array for it. Never invent figures — use 0 and list the field in "notFound" ' +
  'when a number is not stated. Do NOT compute a health score or risk count; ' +
  'those are derived downstream.';

/** Build the user turn carrying the raw policy text. */
export function buildAnalyzeUser(text: string): string {
  return `Analyze the following policy document and return the JSON described.\n\n"""\n${text}\n"""`;
}

// ---------------------------------------------------------------------------
// answerQuestion (R5)
// ---------------------------------------------------------------------------

/** System prompt for grounded question answering. */
export const ANSWER_SYSTEM =
  `${JSON_ONLY}\n\n` +
  'Answer the user question using ONLY the provided policy excerpts. Return JSON:\n' +
  '{ "answer": string, "citedSections": [{ "section": string, "match": number 0..1 }], ' +
  '"groundedInPolicy": boolean }\n' +
  'If the excerpts do not contain enough information to answer, set ' +
  '"groundedInPolicy" to false, return an empty "citedSections" array, and state ' +
  'in "answer" that the policy wording does not cover the question. Never use ' +
  'outside knowledge. Cite the sections you relied on with a match strength.';

/** Build the user turn with numbered excerpts and the question. */
export function buildAnswerUser(ctx: ChunkContext[], question: string): string {
  if (ctx.length === 0) {
    return (
      'No policy excerpts were retrieved for this question. Return groundedInPolicy=false.\n\n' +
      `Question: ${question}`
    );
  }
  const excerpts = ctx
    .map((c, i) => {
      const label = c.section ?? (c.page != null ? `Page ${c.page}` : `Section ${c.chunkIndex + 1}`);
      return `[${i + 1}] (${label}, similarity ${c.similarity.toFixed(2)}): ${c.content}`;
    })
    .join('\n');
  return `Policy excerpts:\n${excerpts}\n\nQuestion: ${question}`;
}

// ---------------------------------------------------------------------------
// comparePolicies (R7)
// ---------------------------------------------------------------------------

/** System prompt for A/B policy comparison. */
export const COMPARE_SYSTEM =
  `${JSON_ONLY}\n\n` +
  'Compare two insurance policies (A and B). Return JSON:\n' +
  '{ "policyAId": string, "policyBId": string, "scoreA": number 0..100, ' +
  '"scoreB": number 0..100, "rows": [{ "label": string, "valueA": string, ' +
  '"valueB": string, "superior": "A|B|equal" }], "winner": "A|B|tie", ' +
  '"recommendation": string }\n' +
  'Cover at least provider, sum insured, premium, co-payment, exclusions, and ' +
  'risk flags. "superior" marks which policy is better for that row. Base the ' +
  'winner on overall value and justify it in "recommendation".';

/** Build the user turn with the two analyses as JSON. */
export function buildCompareUser(a: PolicyAnalysis, b: PolicyAnalysis): string {
  return (
    'Policy A analysis:\n' +
    `${JSON.stringify(a)}\n\n` +
    'Policy B analysis:\n' +
    `${JSON.stringify(b)}`
  );
}

// ---------------------------------------------------------------------------
// simulateClaim (R8)
// ---------------------------------------------------------------------------

/** System prompt for claim simulation. */
export const CLAIM_SYSTEM =
  `${JSON_ONLY}\n\n` +
  'Evaluate whether the described claim scenario would likely be approved under ' +
  'the given policy analysis. Return JSON:\n' +
  '{ "approvalProbability": number 0..100, "checks": [{ "label": string, ' +
  '"status": "ok|warn|fail", "detail": string (optional) }], "reasons": [string], ' +
  '"matchedExclusion": string|null }\n' +
  'Check exclusions, waiting periods, sub-limits, co-payment, and deductibles. If ' +
  'the scenario clearly falls under an exclusion, set "matchedExclusion" to its ' +
  'name and lower the probability sharply.';

/** Build the user turn with the analysis and scenario. */
export function buildClaimUser(analysis: PolicyAnalysis, scenario: string): string {
  return (
    'Policy analysis:\n' +
    `${JSON.stringify(analysis)}\n\n` +
    `Claim scenario: ${scenario}`
  );
}

// ---------------------------------------------------------------------------
// brokerInsights (R13)
// ---------------------------------------------------------------------------

/** System prompt for broker portfolio insights. */
export const INSIGHTS_SYSTEM =
  `${JSON_ONLY}\n\n` +
  'Analyze a broker portfolio and produce categorized insights. Return JSON:\n' +
  '{ "insights": [{ "type": "upsell|risk_alert|renewal_opt|coverage_improvement", ' +
  '"message": string, "clientIds": [string], "evidence": object (optional) }] }\n' +
  'Only reference clientIds that appear in the portfolio. Keep messages concise ' +
  'and actionable. Return an empty array when nothing noteworthy is found.';

/** Build the user turn with the portfolio summary as JSON. */
export function buildInsightsUser(portfolio: PortfolioSummary): string {
  return `Broker portfolio:\n${JSON.stringify(portfolio)}`;
}

// ---------------------------------------------------------------------------
// Repair prompt (R3.10) — used after a JSON parse/validation failure.
// ---------------------------------------------------------------------------

/**
 * Build the single repair turn asking the model to fix its previous output so
 * it strictly matches the schema. `validationError` is the Zod/parse message.
 */
export function buildRepairUser(validationError: string): string {
  return (
    'Your previous response was not valid JSON for the required schema. ' +
    `The validation error was:\n${validationError}\n\n` +
    'Return ONLY the corrected JSON value. No prose, no markdown fences.'
  );
}
