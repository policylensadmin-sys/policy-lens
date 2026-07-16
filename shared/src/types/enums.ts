// Shared enumerations for PolicyLens.
// Each enum is expressed as a `const` tuple (for runtime iteration / Zod schemas)
// plus a derived string-literal union type (for compile-time usage).

/** User role — drives portal routing and RBAC (R17). */
export const ROLES = ['customer', 'broker', 'corporate'] as const;
export type Role = (typeof ROLES)[number];

/** Subscription tier — gates freemium features (R18). */
export const TIERS = ['free', 'premium'] as const;
export type Tier = (typeof TIERS)[number];

/** Insurance product category. */
export const POLICY_CATEGORIES = ['health', 'life', 'motor', 'travel', 'home'] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** Lifecycle status of a customer policy record (R4). */
export const POLICY_STATUSES = ['uploaded', 'processing', 'analyzed', 'failed'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** Lifecycle status of a broker-managed policy (R11). */
export const BROKER_POLICY_STATUSES = [
  'active',
  'pending_renewal',
  'expired',
  'cancelled',
] as const;
export type BrokerPolicyStatus = (typeof BROKER_POLICY_STATUSES)[number];

/** Background job status (R16). */
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Background job processing stage — maps to a progress value (R16.2). */
export const JOB_STAGES = ['queued', 'ocr', 'embedding', 'analysis', 'done'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Risk severity used for hidden clauses (R3). */
export const RISK_LEVELS = ['High', 'Medium', 'Low'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Broker claim status (R12). */
export const CLAIM_STATUSES = ['approved', 'under_review', 'pending', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Commission payment status (R9.3). */
export const COMMISSION_STATUSES = ['paid', 'pending', 'overdue'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** Category of a broker AI insight (R13). */
export const INSIGHT_TYPES = [
  'upsell',
  'risk_alert',
  'renewal_opt',
  'coverage_improvement',
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

/** Recommendation classification shown on the policy dashboard (R4.5). */
export const RECOMMENDATION_KINDS = ['gap', 'risk'] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];
