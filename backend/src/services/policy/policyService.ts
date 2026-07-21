// PolicyService — upload intake + job creation (R1, R16, R21).
//
// Responsibilities (per design "Services" → PolicyService):
//   - Persist the uploaded document to the private Supabase Storage bucket
//     `policies`, namespaced under the owner's folder so row-level security can
//     scope access to the owner (R21.1/R21.2).
//   - Create the `policies` row (status `uploaded`) that represents the stored
//     document, retaining the original filename / mime type alongside the
//     storage path (R21.2).
//   - Enqueue the background `analyze` job (`status=queued`, `stage=queued`,
//     `progress=0`) that the worker pipeline picks up, and return the job
//     acknowledgment together with the created policy (R1.1–R1.3, R16.1).
//
// Failure surfaces are typed so the controller / central error handler can map
// them to the correct HTTP response:
//   - Storage temporarily unavailable during upload → StorageUnavailableError
//     (retryable, R21.5).
//   - Free-tier upload cap → enforced via `assertCanUpload` (placeholder until
//     task 7.2 wires the real freemium check).
//
// The service talks to Supabase through the service-role client (bypasses RLS)
// so it can write on the user's behalf. The client is resolved lazily so the
// module can be imported in mock/dev mode without Supabase credentials.

import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Coverage,
  Exclusion,
  HiddenClause,
  JobStage,
  JobStatus,
  PolicyCategory,
  PolicyStatus,
  Recommendation,
  WaitingPeriod,
} from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import { assertCanUpload } from './freemium';

/** Name of the private Supabase Storage bucket holding uploaded documents. */
export const POLICIES_BUCKET = 'policies';

/** Default category applied when the caller does not specify one at upload. */
const DEFAULT_CATEGORY: PolicyCategory = 'health';

/** Lifetime (seconds) of a generated signed download URL (R6.4/R21.3). */
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Maximum number of top exclusions surfaced on the dashboard summary (R4.1). */
const TOP_EXCLUSIONS_LIMIT = 5;

/** Maximum number of recommendations shown on the dashboard (R4.4). */
const MAX_RECOMMENDATIONS = 5;

/** Health-score quality band labels shown on the dashboard (R4.3). */
export type QualityBand = 'Poor' | 'Fair' | 'Good' | 'Excellent';

/**
 * Map a numeric Health Score (0–100) to its quality band (R4.3):
 * 0–40 Poor, 41–60 Fair, 61–80 Good, 81–100 Excellent.
 */
export function qualityBandForScore(score: number): QualityBand {
  if (score <= 40) return 'Poor';
  if (score <= 60) return 'Fair';
  if (score <= 80) return 'Good';
  return 'Excellent';
}

/**
 * Raised when Supabase Storage is temporarily unavailable (or otherwise fails)
 * while persisting an upload, so the caller can tell the user to retry (R21.5).
 * A `503` keeps it distinct from client (4xx) errors.
 */
export class StorageUnavailableError extends AppError {
  constructor(details?: unknown) {
    super(503, 'Document storage is temporarily unavailable. Please try again.', {
      code: 'storage_unavailable',
      details,
    });
    this.name = 'StorageUnavailableError';
    Object.setPrototypeOf(this, StorageUnavailableError.prototype);
  }
}

/** Input to {@link PolicyService.createFromUpload}. */
export interface CreateFromUploadInput {
  /** Owning profile id (`profiles.id`) — becomes `policies.owner_id`. */
  ownerId: string;
  /** Raw file bytes (from Multer memory storage). */
  file: Buffer;
  /** Declared/verified MIME type (PDF/JPEG/PNG). */
  mimeType: string;
  /** Original client filename, retained for download (R21.2). */
  originalFilename: string;
  /** Optional insurance category; defaults to `health` until analysis refines it. */
  category?: PolicyCategory;
  /** Optional display title; defaults to the original filename. */
  title?: string;
}

/** The created policy record (camel-cased subset of the `policies` row). */
export interface CreatedPolicy {
  id: string;
  ownerId: string;
  category: PolicyCategory;
  title: string;
  provider: string | null;
  storagePath: string;
  originalFilename: string | null;
  mimeType: string | null;
  status: PolicyStatus;
  createdAt: string;
}

/** The enqueued processing job acknowledgment (camel-cased subset of `jobs`). */
export interface CreatedJob {
  id: string;
  ownerId: string;
  policyId: string;
  type: string;
  status: string;
  stage: string | null;
  progress: number;
  createdAt: string;
}

/** Result of {@link PolicyService.createFromUpload}. */
export interface CreateFromUploadResult {
  policy: CreatedPolicy;
  job: CreatedJob;
}

/** Filters accepted by {@link PolicyService.listForOwner} (R6.3). */
export interface VaultFilters {
  /** Free-text query matched against policy title and provider. */
  q?: string;
  /** Restrict to a single insurance category. */
  category?: PolicyCategory;
  /** Restrict to policies assigned to a given family member (R6.6). */
  memberId?: string;
}

/** A vault list entry — a policy plus its headline analysis fields (R6). */
export interface VaultPolicy {
  id: string;
  category: PolicyCategory;
  title: string;
  provider: string | null;
  premiumAmount: number | null;
  premiumCurrency: string | null;
  sumInsured: number | null;
  familyMemberId: string | null;
  originalFilename: string | null;
  status: PolicyStatus;
  /** Health Score when analysis has completed, else `null`. */
  healthScore: number | null;
  /** Number of risk flags identified by analysis (0 when none/not analyzed). */
  riskFlagCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Concise exclusion summary for the dashboard (count + top items) (R4.1). */
export interface ExclusionSummary {
  count: number;
  top: Exclusion[];
}

/**
 * Dashboard payload for a single policy (R4). Bundles the policy record with
 * its structured analysis, plus derived view-model fields (quality band,
 * coverage summary, exclusion summary, waiting periods grouped by duration) and
 * empty-state flags for the no-risk-flags / no-recommendations cases (R4.5/R4.6).
 */
export interface PolicyDashboard {
  policy: {
    id: string;
    category: PolicyCategory;
    title: string;
    provider: string | null;
    premiumAmount: number | null;
    premiumCurrency: string | null;
    sumInsured: number | null;
    familyMemberId: string | null;
    originalFilename: string | null;
    status: PolicyStatus;
    createdAt: string;
    updatedAt: string;
  };
  /** `true` once analysis has completed and a payload is available. */
  analyzed: boolean;
  healthScore: number | null;
  qualityBand: QualityBand | null;
  /** Covered category types (e.g. Hospitalization, ICU) (R4.1). */
  coverageSummary: string[];
  exclusionSummary: ExclusionSummary;
  riskFlagCount: number;
  /** The flagged hidden clauses (clause text + risk level + plain-English impact) (R4.2). */
  hiddenClauses: HiddenClause[];
  /** Waiting periods grouped by their stated duration (R4.1). */
  waitingPeriodsByDuration: Record<string, WaitingPeriod[]>;
  /** Up to 5 recommendations, each tagged gap vs risk (R4.4). */
  recommendations: Recommendation[];
  /** `true` when analysis completed with zero risk flags (R4.5). */
  noRiskFlags: boolean;
  /** `true` when analysis completed with zero recommendations (R4.6). */
  noRecommendations: boolean;
  /** `true` when the analysis is a partial/fallback result (R3.10). */
  partial: boolean;
  /** Categories the analysis could not populate (R3.9). */
  notFound: string[];
}

/** A signed, time-limited download URL for a stored policy document (R6.4). */
export interface DownloadUrl {
  url: string;
  /** Absolute expiry time (ISO 8601). */
  expiresAt: string;
}

/** The job status payload returned to the poller (R16.2). */
export interface JobStatusView {
  id: string;
  policyId: string;
  type: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  queuePosition: number | null;
  attempts: number;
  failedStage: JobStage | null;
  error: string | null;
  extended: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Owns the upload → stored-document → queued-job intake flow for customer
 * policies (R1/R16/R21). Inject a {@link SupabaseClient} for testing; in
 * production it lazily resolves the service-role client.
 */
export class PolicyService {
  private client?: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client;
  }

  /** Resolve the Supabase client lazily (service-role by default). */
  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  /**
   * Store an uploaded document, create its `policies` row, and enqueue the
   * background `analyze` job.
   *
   * @throws {StorageUnavailableError} when the storage upload fails (R21.5).
   * @throws {AppError}                when the freemium cap is hit or a DB
   *                                   write fails.
   */
  async createFromUpload(input: CreateFromUploadInput): Promise<CreateFromUploadResult> {
    const { ownerId, file, mimeType, originalFilename } = input;

    // Freemium gate (R18.1/R18.5). Placeholder until task 7.2 supplies the real
    // check — see assertCanUpload.
    await this.assertCanUpload(ownerId);

    const db = this.db();
    const category = input.category ?? DEFAULT_CATEGORY;
    const title = normalizeTitle(input.title, originalFilename);
    const storagePath = buildStoragePath(ownerId, originalFilename);

    // 1) Persist the original file to owner-namespaced storage (R21.1/R21.2).
    const { error: uploadError } = await db.storage
      .from(POLICIES_BUCKET)
      .upload(storagePath, file, { contentType: mimeType, upsert: false });

    if (uploadError) {
      throw new StorageUnavailableError({ reason: uploadError.message });
    }

    // 2) Insert the policy record (status `uploaded`).
    const { data: policyRow, error: policyError } = await db
      .from('policies')
      .insert({
        owner_id: ownerId,
        category,
        title,
        provider: null,
        storage_path: storagePath,
        original_filename: originalFilename,
        mime_type: mimeType,
        status: 'uploaded',
      })
      .select('id, owner_id, category, title, provider, storage_path, original_filename, mime_type, status, created_at')
      .single();

    if (policyError || !policyRow) {
      // Best-effort cleanup of the just-uploaded object to avoid orphans.
      await this.removeStoredObject(storagePath);
      throw AppError.internal('Failed to create policy record', {
        reason: policyError?.message,
      });
    }

    // 3) Enqueue the background analysis job (R16.1).
    const { data: jobRow, error: jobError } = await db
      .from('jobs')
      .insert({
        owner_id: ownerId,
        policy_id: policyRow.id,
        type: 'analyze',
        status: 'queued',
        stage: 'queued',
        progress: 0,
      })
      .select('id, owner_id, policy_id, type, status, stage, progress, created_at')
      .single();

    if (jobError || !jobRow) {
      // Roll back the policy row and stored object so a failed enqueue does not
      // leave a stranded, never-processed document.
      await db.from('policies').delete().eq('id', policyRow.id);
      await this.removeStoredObject(storagePath);
      throw AppError.internal('Failed to enqueue processing job', {
        reason: jobError?.message,
      });
    }

    return {
      policy: {
        id: policyRow.id as string,
        ownerId: policyRow.owner_id as string,
        category: policyRow.category as PolicyCategory,
        title: policyRow.title as string,
        provider: (policyRow.provider as string | null) ?? null,
        storagePath: policyRow.storage_path as string,
        originalFilename: (policyRow.original_filename as string | null) ?? null,
        mimeType: (policyRow.mime_type as string | null) ?? null,
        status: policyRow.status as PolicyStatus,
        createdAt: policyRow.created_at as string,
      },
      job: {
        id: jobRow.id as string,
        ownerId: jobRow.owner_id as string,
        policyId: jobRow.policy_id as string,
        type: jobRow.type as string,
        status: jobRow.status as string,
        stage: (jobRow.stage as string | null) ?? null,
        progress: jobRow.progress as number,
        createdAt: jobRow.created_at as string,
      },
    };
  }

  /**
   * List the owner's policies for the vault, optionally filtered by free-text
   * query (title/provider), category, and family member (R6.3/R6.6). Results
   * are newest-first and each entry carries its headline analysis fields
   * (Health Score, risk-flag count) so the vault can render at a glance. The
   * query is a single indexed round-trip to stay within the 2s budget (R6.3).
   */
  async listForOwner(ownerId: string, filters: VaultFilters = {}): Promise<VaultPolicy[]> {
    let query = this.db()
      .from('policies')
      .select(
        'id, category, title, provider, premium_amount, premium_currency, sum_insured, ' +
          'family_member_id, original_filename, status, created_at, updated_at, ' +
          'policy_analysis ( health_score, risk_flag_count )',
      )
      .eq('owner_id', ownerId);

    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.memberId) {
      query = query.eq('family_member_id', filters.memberId);
    }
    if (filters.q) {
      // Sanitize the term so it cannot break the PostgREST `or` filter grammar
      // (which is comma/parenthesis-delimited), then match title OR provider.
      const term = sanitizeLikeTerm(filters.q);
      if (term.length > 0) {
        query = query.or(`title.ilike.%${term}%,provider.ilike.%${term}%`);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw AppError.internal('Failed to list policies', { reason: error.message });
    }

    return (data ?? []).map((row) => toVaultPolicy(row as unknown as PolicyWithAnalysisRow));
  }

  /**
   * Build the dashboard payload for a single owned policy (R4). Returns the
   * policy plus its structured analysis and derived view-model fields. Throws
   * `404` when the policy does not exist or is not owned by the caller (RLS is
   * additionally enforced at the DB layer for user-scoped clients).
   */
  async getDashboard(ownerId: string, policyId: string): Promise<PolicyDashboard> {
    const { data, error } = await this.db()
      .from('policies')
      .select(
        'id, category, title, provider, premium_amount, premium_currency, sum_insured, ' +
          'family_member_id, original_filename, status, created_at, updated_at, ' +
          'policy_analysis ( health_score, risk_flag_count, coverage, exclusions, ' +
          'hidden_clauses, waiting_periods, recommendations, not_found, partial )',
      )
      .eq('id', policyId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load policy', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Policy not found');
    }

    return toDashboard(data as unknown as PolicyWithAnalysisRow);
  }

  /**
   * Create a short-lived signed URL for downloading the original policy
   * document (R6.4/R21.3). Throws `404` when the policy is not owned/found and
   * {@link StorageUnavailableError} (retryable) when the storage backend cannot
   * mint a URL (R6.7).
   */
  async getDownloadUrl(ownerId: string, policyId: string): Promise<DownloadUrl> {
    const db = this.db();

    const { data: policy, error } = await db
      .from('policies')
      .select('id, storage_path')
      .eq('id', policyId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load policy', { reason: error.message });
    }
    if (!policy) {
      throw AppError.notFound('Policy not found');
    }
    const storagePath = (policy as { storage_path: string | null }).storage_path;
    if (!storagePath) {
      throw AppError.notFound('No document is available for this policy');
    }

    const { data: signed, error: signError } = await db.storage
      .from(POLICIES_BUCKET)
      .createSignedUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      throw new StorageUnavailableError({ reason: signError?.message });
    }

    return {
      url: signed.signedUrl,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Delete an owned policy and everything derived from it (R6.5). The stored
   * document is removed from Storage first (extracted text lives only in derived
   * rows), then the `policies` row is deleted — the schema's `on delete cascade`
   * foreign keys remove the associated analysis, chunks/embeddings, chats,
   * jobs, comparisons, and claim simulations. Throws `404` when the policy is
   * not owned/found.
   */
  async deletePolicy(ownerId: string, policyId: string): Promise<void> {
    const db = this.db();

    const { data: policy, error } = await db
      .from('policies')
      .select('id, storage_path')
      .eq('id', policyId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load policy', { reason: error.message });
    }
    if (!policy) {
      throw AppError.notFound('Policy not found');
    }

    // Remove the stored original document (best-effort; DB is source of truth).
    const storagePath = (policy as { storage_path: string | null }).storage_path;
    if (storagePath) {
      await this.removeStoredObject(storagePath);
    }

    // Delete the policy row; cascade FKs remove analysis/chunks/chats/jobs/etc.
    const { error: deleteError } = await db
      .from('policies')
      .delete()
      .eq('id', policyId)
      .eq('owner_id', ownerId);

    if (deleteError) {
      throw AppError.internal('Failed to delete policy', { reason: deleteError.message });
    }
  }

  /**
   * Fetch an owned processing job's status/progress for the poller (R16.2).
   * Throws `404` when the job does not exist or is not owned by the caller.
   */
  async getJob(ownerId: string, jobId: string): Promise<JobStatusView> {
    const { data, error } = await this.db()
      .from('jobs')
      .select(
        'id, policy_id, type, status, stage, progress, queue_position, attempts, ' +
          'failed_stage, error, extended, created_at, updated_at',
      )
      .eq('id', jobId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load job', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Job not found');
    }

    return toJobStatusView(data as unknown as JobRow);
  }

  /**
   * Freemium upload gate (R18.1/R18.5). Delegates to the freemium module, which
   * allows premium users and rejects free users at/over the upload cap with an
   * `upgrade_required` error. The resolved Supabase client is forwarded so tests
   * and request-scoped clients are honored.
   */
  private async assertCanUpload(ownerId: string): Promise<void> {
    await assertCanUpload(ownerId, { client: this.db() });
  }

  /** Best-effort removal of a stored object; swallows errors (cleanup path). */
  private async removeStoredObject(storagePath: string): Promise<void> {
    try {
      await this.db().storage.from(POLICIES_BUCKET).remove([storagePath]);
    } catch {
      // Cleanup is best-effort; the primary error is surfaced by the caller.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the owner-namespaced storage path: `{ownerId}/{uuid}-{filename}`.
 * The filename is sanitized to a safe slug (keeping the extension) so arbitrary
 * client-supplied names cannot alter the path structure.
 */
function buildStoragePath(ownerId: string, originalFilename: string): string {
  const ext = extname(originalFilename).toLowerCase();
  const base = originalFilename.slice(0, originalFilename.length - ext.length);
  const safeBase = slugify(base) || 'document';
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
  return `${ownerId}/${randomUUID()}-${safeBase}${safeExt}`;
}

/** Lowercase, replace non-alphanumeric runs with `-`, trim, and cap length. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Choose a non-empty display title, falling back to the original filename. */
function normalizeTitle(title: string | undefined, originalFilename: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return originalFilename.trim() || 'Untitled policy';
}

/**
 * Sanitize a free-text search term for safe embedding in a PostgREST `or`
 * filter. Removes the delimiters (`,` `(` `)`) that would otherwise break the
 * filter grammar, plus `*` (the ilike wildcard) so a user query is treated as a
 * literal substring. Length is capped to keep the URL bounded.
 */
function sanitizeLikeTerm(value: string): string {
  return value
    .replace(/[,()*%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/** Shape of the embedded analysis columns selected alongside a policy row. */
interface AnalysisEmbed {
  health_score: number | null;
  risk_flag_count: number | null;
  coverage?: unknown;
  exclusions?: unknown;
  hidden_clauses?: unknown;
  waiting_periods?: unknown;
  recommendations?: unknown;
  not_found?: unknown;
  partial?: boolean | null;
}

/** A `policies` row with its (optional) embedded `policy_analysis`. */
interface PolicyWithAnalysisRow {
  id: string;
  category: PolicyCategory;
  title: string;
  provider: string | null;
  premium_amount: number | string | null;
  premium_currency: string | null;
  sum_insured: number | string | null;
  family_member_id: string | null;
  original_filename: string | null;
  status: PolicyStatus;
  created_at: string;
  updated_at: string;
  /** PostgREST embeds one-to-one relations as an object or a single-item array. */
  policy_analysis?: AnalysisEmbed | AnalysisEmbed[] | null;
}

/** The subset of a `jobs` row read by {@link PolicyService.getJob}. */
interface JobRow {
  id: string;
  policy_id: string;
  type: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  queue_position: number | null;
  attempts: number;
  failed_stage: JobStage | null;
  error: string | null;
  extended: boolean;
  created_at: string;
  updated_at: string;
}

/** Normalize an embedded analysis (array | object | null) to a single record. */
function firstAnalysis(embed: PolicyWithAnalysisRow['policy_analysis']): AnalysisEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** Coerce a numeric-or-string DB value (numeric columns arrive as strings). */
function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Map a policy(+analysis) row to a vault list entry. */
function toVaultPolicy(row: PolicyWithAnalysisRow): VaultPolicy {
  const analysis = firstAnalysis(row.policy_analysis);
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    provider: row.provider ?? null,
    premiumAmount: toNumberOrNull(row.premium_amount),
    premiumCurrency: row.premium_currency ?? null,
    sumInsured: toNumberOrNull(row.sum_insured),
    familyMemberId: row.family_member_id ?? null,
    originalFilename: row.original_filename ?? null,
    status: row.status,
    healthScore: analysis?.health_score ?? null,
    riskFlagCount: analysis?.risk_flag_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Coerce an unknown JSONB value to a typed array (empty on mismatch). */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Group waiting periods by their stated `duration` (R4.1). */
function groupWaitingPeriods(periods: WaitingPeriod[]): Record<string, WaitingPeriod[]> {
  const grouped: Record<string, WaitingPeriod[]> = {};
  for (const period of periods) {
    const key = period.duration || 'Unspecified';
    (grouped[key] ??= []).push(period);
  }
  return grouped;
}

/** Map a policy(+analysis) row to the dashboard view model (R4). */
function toDashboard(row: PolicyWithAnalysisRow): PolicyDashboard {
  const analysis = firstAnalysis(row.policy_analysis);
  const analyzed = analysis !== null;

  const coverage = toArray<Coverage>(analysis?.coverage);
  const exclusions = toArray<Exclusion>(analysis?.exclusions);
  const hiddenClauses = toArray<HiddenClause>(analysis?.hidden_clauses);
  const waitingPeriods = toArray<WaitingPeriod>(analysis?.waiting_periods);
  const recommendations = toArray<Recommendation>(analysis?.recommendations).slice(
    0,
    MAX_RECOMMENDATIONS,
  );
  const riskFlagCount = analysis?.risk_flag_count ?? 0;
  const healthScore = analysis?.health_score ?? null;

  // Covered category types only (R4.1 coverage summary).
  const coverageSummary = coverage
    .filter((c) => c.covered)
    .map((c) => c.type)
    .filter((type, index, all) => all.indexOf(type) === index);

  return {
    policy: {
      id: row.id,
      category: row.category,
      title: row.title,
      provider: row.provider ?? null,
      premiumAmount: toNumberOrNull(row.premium_amount),
      premiumCurrency: row.premium_currency ?? null,
      sumInsured: toNumberOrNull(row.sum_insured),
      familyMemberId: row.family_member_id ?? null,
      originalFilename: row.original_filename ?? null,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    analyzed,
    healthScore,
    qualityBand: healthScore === null ? null : qualityBandForScore(healthScore),
    coverageSummary,
    exclusionSummary: {
      count: exclusions.length,
      top: exclusions.slice(0, TOP_EXCLUSIONS_LIMIT),
    },
    riskFlagCount,
    hiddenClauses,
    waitingPeriodsByDuration: groupWaitingPeriods(waitingPeriods),
    recommendations,
    // Empty-state flags only assert once analysis has completed (R4.5/R4.6).
    noRiskFlags: analyzed && riskFlagCount === 0,
    noRecommendations: analyzed && recommendations.length === 0,
    partial: analysis?.partial ?? false,
    notFound: toArray<string>(analysis?.not_found),
  };
}

/** Map a `jobs` row to the poll view model (R16.2). */
function toJobStatusView(row: JobRow): JobStatusView {
  return {
    id: row.id,
    policyId: row.policy_id,
    type: row.type,
    status: row.status,
    stage: row.stage ?? null,
    progress: row.progress,
    queuePosition: row.queue_position ?? null,
    attempts: row.attempts,
    failedStage: row.failed_stage ?? null,
    error: row.error ?? null,
    extended: row.extended,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
