// AI engine types: RAG context/answers, comparison, claim simulation, and
// broker insights (R5, R7, R8, R13, R15).

import type { InsightType } from './enums.js';
import type { Timestamp } from './common.js';
import type { PolicyAnalysis } from './analysis.js';

/** A retrieved policy chunk supplied as grounding context for RAG (R15). */
export interface ChunkContext {
  chunkIndex: number;
  content: string;
  section?: string | null;
  page?: number | null;
  /** Cosine similarity to the query, in [0, 1]. */
  similarity: number;
}

/** A cited source section returned alongside a grounded answer (R5.2). */
export interface CitedSection {
  section: string;
  /** Match strength in [0, 1]. */
  match: number;
}

/** A grounded, plain-English answer to a policy question (R5). */
export interface GroundedAnswer {
  answer: string;
  citedSections: CitedSection[];
  /** False when the question could not be answered from the policy (R5.4). */
  groundedInPolicy: boolean;
}

/** A semantic search hit with a match percentage (R15.2, R15.3). */
export interface SearchResult {
  chunkIndex: number;
  content: string;
  section?: string | null;
  page?: number | null;
  /** Match percentage 0–100 (derived from similarity). */
  matchPercent: number;
}

/** One row of an A/B policy comparison, indicating the superior policy (R7). */
export interface ComparisonRow {
  label: string;
  valueA: string;
  valueB: string;
  /** Which policy is superior for this attribute. */
  superior: 'A' | 'B' | 'equal';
}

/** Structured A/B comparison with a Health-Score-based recommendation (R7). */
export interface ComparisonResult {
  policyAId: string;
  policyBId: string;
  /** Health scores (0–100) for each policy. */
  scoreA: number;
  scoreB: number;
  rows: ComparisonRow[];
  /** Recommended policy, or a tie. */
  winner: 'A' | 'B' | 'tie';
  recommendation: string;
}

/** Status of a single claim-simulation check. */
export type ClaimCheckStatus = 'ok' | 'warn' | 'fail';

/** One evaluated check in a claim simulation (R8). */
export interface ClaimCheck {
  label: string;
  status: ClaimCheckStatus;
  detail?: string;
}

/** Result of simulating a claim scenario against a policy (R8). */
export interface ClaimResult {
  /** Approval probability 0–100. */
  approvalProbability: number;
  checks: ClaimCheck[];
  reasons: string[];
  /** Exclusion that blocks the claim, if matched (R8.4). */
  matchedExclusion?: string | null;
}

/** A categorized AI insight for a broker's portfolio (R13). */
export interface Insight {
  id?: string;
  type: InsightType;
  message: string;
  /** Clients affected by this insight. */
  clientIds: string[];
  /** Supporting evidence (attributes/metrics that triggered the insight). */
  evidence?: unknown;
  generatedAt: Timestamp;
}

/** Summary of a policy within a broker portfolio, used to derive insights. */
export interface PortfolioPolicySummary {
  policyId: string;
  clientId: string;
  policyType: string;
  premiumAmount: number;
  sumInsured?: number | null;
  analysis?: PolicyAnalysis | null;
}

/** Aggregated portfolio input to `AIProvider.brokerInsights` (R13). */
export interface PortfolioSummary {
  brokerId: string;
  totalClients: number;
  totalPolicies: number;
  totalPremium: number;
  policies: PortfolioPolicySummary[];
  /** Named risk counts (e.g. underinsured, missing family coverage). */
  riskCounts?: Record<string, number>;
}
