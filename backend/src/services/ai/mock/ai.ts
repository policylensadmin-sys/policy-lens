// Mock AI provider (Demo/Mock mode, R3/R5/R7/R8/R13).
//
// Produces deterministic, schema-shaped intelligence with no external LLM:
//   - analyzePolicy   → a canned, schema-valid PolicyAnalysis matched to text.
//   - answerQuestion  → a grounded answer citing the supplied chunks, or a
//                       refusal when no context is available (R5.4).
//   - comparePolicies → a structured A/B comparison driven by Health Scores.
//   - simulateClaim   → an approval probability with per-check reasoning.
//   - brokerInsights  → categorized portfolio insights.
// All outputs are deterministic for a given input so demos and tests are stable.

import type { AIProvider } from '../types';
import type {
  ChunkContext,
  CitedSection,
  ClaimCheck,
  ClaimResult,
  ComparisonResult,
  ComparisonRow,
  GroundedAnswer,
  Insight,
  PolicyAnalysis,
  PortfolioSummary,
} from '@policylens/shared';
import { detectAnalysis } from './analyses';

/** Fixed timestamp so mock insights are byte-stable across runs. */
const MOCK_TIMESTAMP = '2024-01-01T00:00:00.000Z';

/** Deterministic mock AI provider. */
export class MockAIProvider implements AIProvider {
  analyzePolicy(text: string): Promise<PolicyAnalysis> {
    return Promise.resolve(detectAnalysis(text));
  }

  answerQuestion(ctx: ChunkContext[], q: string): Promise<GroundedAnswer> {
    return Promise.resolve(buildAnswer(ctx, q));
  }

  comparePolicies(a: PolicyAnalysis, b: PolicyAnalysis): Promise<ComparisonResult> {
    return Promise.resolve(buildComparison(a, b));
  }

  simulateClaim(analysis: PolicyAnalysis, scenario: string): Promise<ClaimResult> {
    return Promise.resolve(buildClaimResult(analysis, scenario));
  }

  brokerInsights(portfolio: PortfolioSummary): Promise<Insight[]> {
    return Promise.resolve(buildInsights(portfolio));
  }
}

// ---------------------------------------------------------------------------
// answerQuestion (R5)
// ---------------------------------------------------------------------------

function buildAnswer(ctx: ChunkContext[], q: string): GroundedAnswer {
  if (ctx.length === 0) {
    return {
      answer:
        'I could not find anything in this policy document that answers your question, so I cannot answer it from the policy wording.',
      citedSections: [],
      groundedInPolicy: false,
    };
  }

  // Rank by similarity and cite the strongest sections.
  const ranked = [...ctx].sort((x, y) => y.similarity - x.similarity);
  const top = ranked.slice(0, 3);
  const citedSections: CitedSection[] = top.map((c) => ({
    section: labelFor(c),
    match: clamp01(c.similarity),
  }));

  const intro = introFor(q);
  const evidence = top
    .map((c, i) => `[${i + 1}] ${labelFor(c)}: ${condense(c.content)}`)
    .join(' ');

  return {
    answer: `${intro} ${evidence}`.trim(),
    citedSections,
    groundedInPolicy: true,
  };
}

/** A short, keyword-aware lead-in that keeps the answer grounded. */
function introFor(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('waiting')) return 'Based on the policy wording, the applicable waiting periods are:';
  if (lower.includes('exclu')) return 'According to the policy, the following exclusions apply:';
  if (lower.includes('room') || lower.includes('rent')) return 'The policy specifies these room-rent limits:';
  if (lower.includes('co-pay') || lower.includes('copay')) return 'On co-payment, the policy states:';
  if (lower.includes('claim')) return 'For claims, the relevant policy text is:';
  return 'Based on the relevant sections of your policy:';
}

/** A stable, human-readable label for a cited chunk. */
function labelFor(c: ChunkContext): string {
  if (c.section) return c.section;
  if (c.page != null) return `Page ${c.page}`;
  return `Section ${c.chunkIndex + 1}`;
}

/** Trim chunk content to a single, readable sentence-ish snippet. */
function condense(content: string): string {
  const clean = content.trim().replace(/\s+/g, ' ');
  return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
}

// ---------------------------------------------------------------------------
// comparePolicies (R7)
// ---------------------------------------------------------------------------

function buildComparison(a: PolicyAnalysis, b: PolicyAnalysis): ComparisonResult {
  const scoreA = a.healthScore ?? 50;
  const scoreB = b.healthScore ?? 50;

  const rows: ComparisonRow[] = [
    row('Provider', a.provider, b.provider, 'equal'),
    row(
      'Sum Insured',
      formatAmount(a.sumInsured),
      formatAmount(b.sumInsured),
      higherIsBetter(a.sumInsured, b.sumInsured),
    ),
    row(
      'Annual Premium',
      formatMoney(a.premium.amount, a.premium.currency),
      formatMoney(b.premium.amount, b.premium.currency),
      lowerIsBetter(a.premium.amount, b.premium.amount),
    ),
    row(
      'Max Co-payment',
      `${maxCoPay(a)}%`,
      `${maxCoPay(b)}%`,
      lowerIsBetter(maxCoPay(a), maxCoPay(b)),
    ),
    row(
      'Exclusions',
      `${a.exclusions.length}`,
      `${b.exclusions.length}`,
      lowerIsBetter(a.exclusions.length, b.exclusions.length),
    ),
    row(
      'Risk Flags',
      `${a.riskFlagCount ?? a.hiddenClauses.length}`,
      `${b.riskFlagCount ?? b.hiddenClauses.length}`,
      lowerIsBetter(a.riskFlagCount ?? a.hiddenClauses.length, b.riskFlagCount ?? b.hiddenClauses.length),
    ),
    row('Health Score', `${scoreA}`, `${scoreB}`, higherIsBetter(scoreA, scoreB)),
  ];

  const winner: ComparisonResult['winner'] = scoreA === scoreB ? 'tie' : scoreA > scoreB ? 'A' : 'B';
  const recommendation =
    winner === 'tie'
      ? `Both policies score ${scoreA}/100 and are closely matched; choose based on premium and preferred provider.`
      : `Policy ${winner} (${winner === 'A' ? a.provider : b.provider}) scores higher (${Math.max(
          scoreA,
          scoreB,
        )} vs ${Math.min(scoreA, scoreB)}) and offers better overall value.`;

  return {
    policyAId: a.provider,
    policyBId: b.provider,
    scoreA,
    scoreB,
    rows,
    winner,
    recommendation,
  };
}

function row(label: string, valueA: string, valueB: string, superior: ComparisonRow['superior']): ComparisonRow {
  return { label, valueA, valueB, superior };
}

function higherIsBetter(a: number, b: number): ComparisonRow['superior'] {
  return a === b ? 'equal' : a > b ? 'A' : 'B';
}

function lowerIsBetter(a: number, b: number): ComparisonRow['superior'] {
  return a === b ? 'equal' : a < b ? 'A' : 'B';
}

function maxCoPay(analysis: PolicyAnalysis): number {
  return analysis.coPay.reduce((max, c) => Math.max(max, c.percent), 0);
}

// ---------------------------------------------------------------------------
// simulateClaim (R8)
// ---------------------------------------------------------------------------

function buildClaimResult(analysis: PolicyAnalysis, scenario: string): ClaimResult {
  const lower = scenario.toLowerCase();
  const checks: ClaimCheck[] = [];
  const reasons: string[] = [];
  let probability = 90;

  // 1) Exclusion match — the strongest blocker.
  const matched = analysis.exclusions.find((ex) => scenarioHitsExclusion(lower, ex.name));
  if (matched) {
    checks.push({ label: 'Exclusion check', status: 'fail', detail: `Scenario matches exclusion: ${matched.name}.` });
    reasons.push(`The scenario appears to fall under the "${matched.name}" exclusion, which is not covered.`);
    probability -= 65;
  } else {
    checks.push({ label: 'Exclusion check', status: 'ok', detail: 'No matching exclusion found.' });
  }

  // 2) Waiting period.
  const wp = analysis.waitingPeriods[0];
  if (wp) {
    checks.push({
      label: 'Waiting period',
      status: 'warn',
      detail: `A waiting period of ${wp.duration} applies to ${wp.appliesTo}; confirm the policy is past it.`,
    });
    reasons.push(`Confirm the ${wp.duration} waiting period for ${wp.appliesTo} has elapsed.`);
    probability -= 10;
  } else {
    checks.push({ label: 'Waiting period', status: 'ok', detail: 'No waiting period applies.' });
  }

  // 3) Sub-limits / room rent.
  const limit = analysis.financialLimits[0];
  if (limit) {
    checks.push({
      label: 'Sub-limits',
      status: 'warn',
      detail: `A limit applies: ${limit.name} = ${limit.value}${limit.unit ? ` ${limit.unit}` : ''}.`,
    });
    reasons.push(`Payout may be capped by "${limit.name}".`);
    probability -= 5;
  }

  // 4) Co-payment.
  const coPay = maxCoPay(analysis);
  if (coPay > 0) {
    checks.push({ label: 'Co-payment', status: 'warn', detail: `A co-payment of ${coPay}% may reduce the settlement.` });
    reasons.push(`Expect a ${coPay}% co-payment deduction if the age/condition trigger applies.`);
    probability -= 5;
  }

  // 5) Deductible.
  const ded = analysis.deductibles[0];
  if (ded) {
    checks.push({ label: 'Deductible', status: 'ok', detail: `A deductible of ${formatAmount(ded.amount)} applies per claim.` });
  }

  if (!matched) {
    reasons.unshift('The scenario is consistent with the covered benefits of the policy.');
  }

  return {
    approvalProbability: clampInt(probability, 0, 100),
    checks,
    reasons,
    matchedExclusion: matched ? matched.name : null,
  };
}

/** Loose keyword match between a scenario and an exclusion name. */
function scenarioHitsExclusion(scenario: string, exclusionName: string): boolean {
  const words = exclusionName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4);
  return words.some((w) => scenario.includes(w));
}

// ---------------------------------------------------------------------------
// brokerInsights (R13)
// ---------------------------------------------------------------------------

function buildInsights(portfolio: PortfolioSummary): Insight[] {
  const insights: Insight[] = [];
  const allClientIds = unique(portfolio.policies.map((p) => p.clientId));

  // Upsell: clients whose sum insured looks low relative to premium.
  const underinsured = portfolio.policies.filter(
    (p) => (p.sumInsured ?? 0) > 0 && (p.sumInsured ?? 0) < 500000,
  );
  if (underinsured.length > 0) {
    insights.push({
      type: 'upsell',
      message: `${underinsured.length} client(s) hold sum insured below INR 5L — strong candidates for a top-up or higher cover.`,
      clientIds: unique(underinsured.map((p) => p.clientId)),
      evidence: { threshold: 500000, count: underinsured.length },
      generatedAt: MOCK_TIMESTAMP,
    });
  }

  // Risk alert: policies whose analysis flags High-risk hidden clauses.
  const highRisk = portfolio.policies.filter(
    (p) => (p.analysis?.hiddenClauses ?? []).some((c) => c.risk === 'High'),
  );
  if (highRisk.length > 0) {
    insights.push({
      type: 'risk_alert',
      message: `${highRisk.length} policy(ies) contain High-risk clauses (e.g. proportionate deduction) that could reduce claim payouts.`,
      clientIds: unique(highRisk.map((p) => p.clientId)),
      evidence: { risk: 'High', count: highRisk.length },
      generatedAt: MOCK_TIMESTAMP,
    });
  }

  // Renewal optimization: always surfaced across the book.
  if (portfolio.totalPolicies > 0) {
    insights.push({
      type: 'renewal_opt',
      message: `Review renewals across ${portfolio.totalPolicies} policies to consolidate premiums (currently INR ${portfolio.totalPremium.toLocaleString('en-IN')}) and negotiate better terms.`,
      clientIds: allClientIds,
      evidence: { totalPremium: portfolio.totalPremium, totalPolicies: portfolio.totalPolicies },
      generatedAt: MOCK_TIMESTAMP,
    });
  }

  // Coverage improvement: clients missing analysis (not yet analyzed) or gaps.
  const needsCoverageReview = portfolio.policies.filter(
    (p) => !p.analysis || (p.analysis.recommendations ?? []).some((r) => r.kind === 'gap'),
  );
  if (needsCoverageReview.length > 0) {
    insights.push({
      type: 'coverage_improvement',
      message: `${needsCoverageReview.length} client(s) have coverage gaps or un-analyzed policies worth a proactive review.`,
      clientIds: unique(needsCoverageReview.map((p) => p.clientId)),
      evidence: { count: needsCoverageReview.length },
      generatedAt: MOCK_TIMESTAMP,
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Small formatting / numeric helpers.
// ---------------------------------------------------------------------------

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatAmount(value: number): string {
  return `INR ${value.toLocaleString('en-IN')}`;
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-IN')}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
