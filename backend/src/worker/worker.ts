// Background processing worker — job loop + stage pipeline (R16.1–R16.3).
//
// The worker drains the `jobs` table: it claims a `queued` job, then drives it
// through the processing pipeline, writing a `stage`/`progress` value at each
// transition so the frontend's `GET /api/jobs/:id` poll can render the
// Upload → Extract → Analyze → Done indicator (R16.2). On completion it inserts
// an in-app notification for the policy owner (R16.3).
//
// Pipeline stages and their progress values (per the design's Background
// Processing Pipeline):
//
//   queued(0) → ocr(25) → embedding(55) → analysis(80) → done(100)
//
//   • ocr:       download the uploaded file from Supabase Storage and run
//                ParserService.extract to obtain the policy text (R2).
//   • embedding: chunk the text (ChunkingService.chunkText) and embed + persist
//                the chunks to `policy_chunks` (EmbeddingsService.embedAndStore) (R15.1).
//   • analysis:  produce structured analysis (AnalysisService.analyze), upsert
//                `policy_analysis`, and mark the policy `analyzed` (R3).
//   • done:      mark the job done and notify the owner (R16.3).
//
// Collaborators (Supabase client + parser/embeddings/analysis services) are
// injected so `processNextJob` is unit-testable in isolation and so the worker
// entry point (`index.ts`) can wire the real providers from the AI factory.
//
// Scope note: task 6.1 implemented the happy-path pipeline, progress tracking,
// and the completion notification. This task (6.2) layers on the operational
// semantics of Requirement 16:
//   • Failure handling + retry (R16.4): a failed stage records
//     `status=failed`, `failed_stage`, `error` and increments `attempts`;
//     `retryJob` re-queues a failed job while `attempts < JOB_MAX_ATTEMPTS`.
//   • Per-user concurrency cap (R16.7): at most `JOB_CONCURRENCY_PER_USER`
//     running jobs per owner; claiming skips owners already at the cap and
//     `queue_position` is recomputed for each owner's waiting jobs.
//   • Extended flag (R16.6): documents over `EXTENDED_PAGE_THRESHOLD` pages set
//     `jobs.extended=true` so the UI can warn about longer processing time.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobStage } from '@policylens/shared';

import { config } from '../config/index';
import { getSupabaseServiceRoleClient } from '../lib/supabase';
import { createAiProviders } from '../services/ai/factory';
import { ParserService } from '../services/policy/parser';
import { EmbeddingsService } from '../services/policy/embeddings';
import { AnalysisService } from '../services/policy/analysis';
import { chunkText } from '../services/policy/chunking';

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/** Supabase Storage bucket holding uploaded policy documents (owner-namespaced). */
export const POLICIES_BUCKET = 'policies';

/** Table names touched by the pipeline. */
const JOBS_TABLE = 'jobs';
const POLICIES_TABLE = 'policies';
const POLICY_ANALYSIS_TABLE = 'policy_analysis';
const NOTIFICATIONS_TABLE = 'notifications';

/** Notification `type` emitted when a job completes (R16.3). */
export const JOB_DONE_NOTIFICATION_TYPE = 'policy_analysis_ready';

/**
 * Progress value (0–100) associated with each pipeline stage (R16.2). The
 * frontend maps these to the Upload → Extract → Analyze → Done indicator.
 */
export const STAGE_PROGRESS: Record<JobStage, number> = {
  queued: 0,
  ocr: 25,
  embedding: 55,
  analysis: 80,
  done: 100,
};

/** Default poll interval for the loop, in milliseconds. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Page count above which a document is flagged `extended` (R16.6). Standard
 * policies (≤ 50 pages) target ≤ 40s; larger documents warn the user of a
 * longer processing time via the `jobs.extended` flag.
 */
export const EXTENDED_PAGE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/** Minimal logger surface (defaults to `console`). */
export interface WorkerLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const defaultLogger: WorkerLogger = {
  // eslint-disable-next-line no-console
  info: (m) => console.log(m),
  // eslint-disable-next-line no-console
  warn: (m) => console.warn(m),
  // eslint-disable-next-line no-console
  error: (m) => console.error(m),
};

/** The subset of a `jobs` row the worker reads. */
interface JobRow {
  id: string;
  owner_id: string;
  policy_id: string;
  type: string;
  status: string;
  stage: string | null;
  progress: number;
  queue_position: number | null;
  attempts: number;
  extended: boolean;
}

/** Columns selected whenever the worker reads a job row. */
const JOB_COLUMNS =
  'id, owner_id, policy_id, type, status, stage, progress, queue_position, attempts, extended';

/** The subset of a `policies` row the worker reads to fetch the source file. */
interface PolicyRow {
  id: string;
  owner_id: string;
  storage_path: string | null;
  mime_type: string | null;
  original_filename: string | null;
}

/** Dependencies injected into the worker (all overridable for tests). */
export interface WorkerDeps {
  /** Service-role Supabase client (bypasses RLS; the worker runs server-side). */
  client: SupabaseClient;
  parser: ParserService;
  embeddings: EmbeddingsService;
  analysis: AnalysisService;
  /** Storage bucket name (defaults to {@link POLICIES_BUCKET}). */
  bucket?: string;
  /**
   * Maximum attempts (including the first) before a failed job may no longer be
   * retried (R16.4). Defaults to `config.limits.jobMaxAttempts` (3).
   */
  maxAttempts?: number;
  /**
   * Maximum concurrently `running` jobs per owner (R16.7). Owners at this cap
   * are skipped when claiming and their extra jobs stay `queued` with a
   * computed `queue_position`. Defaults to `config.limits.jobConcurrencyPerUser`
   * (5).
   */
  concurrencyPerUser?: number;
  logger?: WorkerLogger;
}

/** Outcome of a single {@link processNextJob} call. */
export interface ProcessResult {
  /** `'idle'` when no queued job was available; otherwise the terminal status. */
  outcome: 'idle' | 'done' | 'failed';
  /** The job id that was processed, when one was claimed. */
  jobId?: string;
  /** Populated when `outcome === 'failed'`. */
  error?: string;
  /** Stage at which processing failed, when `outcome === 'failed'`. */
  failedStage?: JobStage;
}

// ---------------------------------------------------------------------------
// Dependency assembly.
// ---------------------------------------------------------------------------

/**
 * Build the default worker dependencies: the service-role Supabase client plus
 * the parsing/embedding/analysis services wired to the providers selected by
 * {@link createAiProviders} (mock adapters when no keys are configured).
 */
export function createWorkerDeps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  const client = overrides.client ?? getSupabaseServiceRoleClient();
  const providers = createAiProviders();

  return {
    client,
    parser: overrides.parser ?? new ParserService(providers.ocr),
    embeddings: overrides.embeddings ?? new EmbeddingsService(providers.embedding, { client }),
    analysis: overrides.analysis ?? new AnalysisService(providers.ai),
    bucket: overrides.bucket ?? POLICIES_BUCKET,
    maxAttempts: overrides.maxAttempts ?? config.limits.jobMaxAttempts,
    concurrencyPerUser: overrides.concurrencyPerUser ?? config.limits.jobConcurrencyPerUser,
    logger: overrides.logger ?? defaultLogger,
  };
}

// ---------------------------------------------------------------------------
// Job claiming.
// ---------------------------------------------------------------------------

/**
 * Count the currently `running` jobs grouped by owner. Used to enforce the
 * per-user concurrency cap (R16.7) both when claiming and when computing queue
 * positions.
 */
async function countRunningByOwner(
  client: SupabaseClient,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await client
    .from(JOBS_TABLE)
    .select('owner_id')
    .eq('status', 'running');

  if (error) {
    throw new Error(`Failed to count running jobs: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{ owner_id: string }>) {
    counts.set(row.owner_id, (counts.get(row.owner_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Recompute and persist `queue_position` for every `queued` job (R16.7).
 *
 * For each owner the queued jobs are ordered FIFO (by `created_at`). The first
 * `max(0, cap - running)` of them can start immediately, so their
 * `queue_position` is cleared (`null`). Every job beyond that is waiting behind
 * the concurrency cap and receives a 1-based `queue_position` (1 = next to run
 * once a slot frees up), which the UI surfaces to the user.
 *
 * Positions are only written when they actually change, to avoid needless
 * writes (and `updated_at` churn) on every poll.
 */
async function updateQueuePositions(
  client: SupabaseClient,
  concurrencyPerUser: number,
  logger: WorkerLogger,
): Promise<void> {
  const runningByOwner = await countRunningByOwner(client);

  const { data, error } = await client
    .from(JOBS_TABLE)
    .select('id, owner_id, queue_position')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error) {
    logger.error(`[worker] failed to load queued jobs for positioning: ${error.message}`);
    return;
  }

  const queued = (data ?? []) as Array<{
    id: string;
    owner_id: string;
    queue_position: number | null;
  }>;

  // Per-owner running index while we walk the FIFO-ordered queue.
  const seenByOwner = new Map<string, number>();

  for (const row of queued) {
    const alreadyQueuedForOwner = seenByOwner.get(row.owner_id) ?? 0;
    seenByOwner.set(row.owner_id, alreadyQueuedForOwner + 1);

    const running = runningByOwner.get(row.owner_id) ?? 0;
    const available = Math.max(0, concurrencyPerUser - running);

    // Jobs within the available slots can run now → no visible queue position.
    // Jobs beyond the cap get a 1-based position among the waiting overflow.
    const desired =
      alreadyQueuedForOwner < available ? null : alreadyQueuedForOwner - available + 1;

    if (desired === row.queue_position) continue;

    const { error: updateError } = await client
      .from(JOBS_TABLE)
      .update({ queue_position: desired, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'queued');
    if (updateError) {
      logger.error(
        `[worker] failed to set queue_position for job ${row.id}: ${updateError.message}`,
      );
    }
  }
}

/**
 * Atomically claim the oldest eligible `queued` job, honouring the per-user
 * concurrency cap (R16.7).
 *
 * Candidates are the queued jobs ordered FIFO. An owner already running
 * `concurrencyPerUser` jobs is skipped so their work stays queued. The chosen
 * row is flipped to `running` with a conditional update guarded by
 * `.eq('status', 'queued')`: if another worker won the race, zero rows update
 * and we move on to the next eligible candidate, so a job is never processed
 * twice.
 */
async function claimNextJob(
  client: SupabaseClient,
  concurrencyPerUser: number,
  logger: WorkerLogger,
): Promise<JobRow | null> {
  const runningByOwner = await countRunningByOwner(client);

  const { data: candidates, error: selectError } = await client
    .from(JOBS_TABLE)
    .select(JOB_COLUMNS)
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (selectError) {
    logger.error(`[worker] failed to query queued jobs: ${selectError.message}`);
    return null;
  }

  for (const candidate of (candidates ?? []) as JobRow[]) {
    const running = runningByOwner.get(candidate.owner_id) ?? 0;
    // Skip owners already at the per-user concurrency cap.
    if (running >= concurrencyPerUser) continue;

    const { data: claimed, error: claimError } = await client
      .from(JOBS_TABLE)
      .update({
        status: 'running',
        stage: 'queued',
        progress: STAGE_PROGRESS.queued,
        queue_position: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)
      .eq('status', 'queued')
      .select(JOB_COLUMNS)
      .maybeSingle();

    if (claimError) {
      logger.error(`[worker] failed to claim job ${candidate.id}: ${claimError.message}`);
      continue;
    }

    // `null` means another worker won the race — try the next candidate.
    if (claimed) return claimed as JobRow;
  }

  return null;
}

/** Persist a stage transition: update `stage` and the matching `progress` (R16.2). */
async function setStage(
  client: SupabaseClient,
  jobId: string,
  stage: JobStage,
): Promise<void> {
  const { error } = await client
    .from(JOBS_TABLE)
    .update({ stage, progress: STAGE_PROGRESS[stage], updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) {
    throw new Error(`Failed to update job ${jobId} to stage "${stage}": ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Single-job processing (the testable unit).
// ---------------------------------------------------------------------------

/**
 * Claim and fully process the next queued job through the pipeline.
 *
 * Returns `{ outcome: 'idle' }` when no queued job is available. Otherwise runs
 * ocr → embedding → analysis → done, writing progress at each transition, and
 * returns the terminal outcome.
 */
export async function processNextJob(deps: WorkerDeps): Promise<ProcessResult> {
  const { client, logger = defaultLogger } = deps;
  const concurrencyPerUser = deps.concurrencyPerUser ?? config.limits.jobConcurrencyPerUser;

  // Keep every waiting job's queue_position current before we claim, so the UI
  // reflects the live queue even for owners parked behind the concurrency cap.
  await updateQueuePositions(client, concurrencyPerUser, logger);

  const job = await claimNextJob(client, concurrencyPerUser, logger);
  if (!job) return { outcome: 'idle' };

  logger.info(`[worker] claimed job ${job.id} (policy ${job.policy_id})`);

  try {
    await runPipeline(deps, job);
    logger.info(`[worker] job ${job.id} complete`);
    return { outcome: 'done', jobId: job.id };
  } catch (err) {
    const stage = currentStageOf(err);
    const message = describeError(err);
    logger.error(`[worker] job ${job.id} failed at stage "${stage}": ${message}`);
    // Record the failure and increment attempts (R16.4). The job is left in a
    // terminal `failed` state; a user may re-queue it via `retryJob` while
    // attempts remain below the cap.
    await recordFailure(client, job, stage, message, logger);
    return { outcome: 'failed', jobId: job.id, error: message, failedStage: stage };
  }
}

/** Drive a claimed job through every pipeline stage in order. */
async function runPipeline(deps: WorkerDeps, job: JobRow): Promise<void> {
  const { client, parser, embeddings, analysis, bucket = POLICIES_BUCKET } = deps;

  // --- Stage: ocr (25) — download + extract text (R2). --------------------
  await setStage(client, job.id, 'ocr');
  await markPolicyStatus(client, job.policy_id, 'processing');

  const policy = await loadPolicy(client, job.policy_id);
  const file = await downloadPolicyFile(client, bucket, policy);
  const extracted = await stageStep('ocr', () => parser.extract(file, policy.mime_type ?? ''));

  // Flag long documents so the UI can warn about extended processing (R16.6).
  // Page count comes from the parser result now that the document is parsed.
  if (extracted.pages.length > EXTENDED_PAGE_THRESHOLD && !job.extended) {
    await markExtended(client, job.id);
  }

  // --- Stage: embedding (55) — chunk + embed + persist (R15.1). -----------
  await setStage(client, job.id, 'embedding');
  const chunks = chunkText(
    extracted.pages.length > 0
      ? extracted.pages.map((p) => ({ text: p.text, page: p.page }))
      : extracted.text,
  );
  await stageStep('embedding', () => embeddings.embedAndStore(job.policy_id, chunks));

  // --- Stage: analysis (80) — structured analysis + persist (R3). ---------
  await setStage(client, job.id, 'analysis');
  const result = await stageStep('analysis', () => analysis.analyze(extracted.text));
  await upsertAnalysis(client, job.policy_id, result);
  await applyAnalysisToPolicy(client, job.policy_id, result);
  await markPolicyStatus(client, job.policy_id, 'analyzed');

  // --- Stage: done (100) — complete + notify owner (R16.3). ---------------
  await completeJob(client, job.id);
  await notifyOwner(client, job, policy);
}

// ---------------------------------------------------------------------------
// Pipeline step helpers.
// ---------------------------------------------------------------------------

/** Load the policy row backing a job; throws if it is missing. */
async function loadPolicy(client: SupabaseClient, policyId: string): Promise<PolicyRow> {
  const { data, error } = await client
    .from(POLICIES_TABLE)
    .select('id, owner_id, storage_path, mime_type, original_filename')
    .eq('id', policyId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load policy ${policyId}: ${error.message}`);
  if (!data) throw new Error(`Policy ${policyId} not found.`);
  return data as PolicyRow;
}

/** Download the uploaded document from Supabase Storage as a Buffer. */
async function downloadPolicyFile(
  client: SupabaseClient,
  bucket: string,
  policy: PolicyRow,
): Promise<Buffer> {
  if (!policy.storage_path) {
    throw new Error(`Policy ${policy.id} has no storage_path to download.`);
  }

  const { data, error } = await client.storage.from(bucket).download(policy.storage_path);
  if (error) {
    throw new Error(`Failed to download "${policy.storage_path}": ${error.message}`);
  }
  if (!data) {
    throw new Error(`Storage returned no data for "${policy.storage_path}".`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Set the policy's lifecycle status. */
async function markPolicyStatus(
  client: SupabaseClient,
  policyId: string,
  status: 'processing' | 'analyzed' | 'failed',
): Promise<void> {
  const { error } = await client
    .from(POLICIES_TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', policyId);
  if (error) {
    throw new Error(`Failed to set policy ${policyId} status "${status}": ${error.message}`);
  }
}

/** Upsert the structured analysis into `policy_analysis` (one row per policy). */
async function upsertAnalysis(
  client: SupabaseClient,
  policyId: string,
  analysis: import('@policylens/shared').PolicyAnalysis,
): Promise<void> {
  const row = {
    policy_id: policyId,
    health_score: analysis.healthScore ?? null,
    coverage: analysis.coverage,
    exclusions: analysis.exclusions,
    waiting_periods: analysis.waitingPeriods,
    financial_limits: analysis.financialLimits,
    co_pay: analysis.coPay,
    deductibles: analysis.deductibles,
    hidden_clauses: analysis.hiddenClauses,
    recommendations: analysis.recommendations,
    risk_flag_count: analysis.riskFlagCount ?? 0,
    not_found: analysis.notFound,
    partial: analysis.partial,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client
    .from(POLICY_ANALYSIS_TABLE)
    .upsert(row, { onConflict: 'policy_id' });
  if (error) {
    throw new Error(`Failed to upsert analysis for policy ${policyId}: ${error.message}`);
  }
}

/** Copy the analysis's headline fields (provider, premium, sum insured) onto the policy. */
async function applyAnalysisToPolicy(
  client: SupabaseClient,
  policyId: string,
  analysis: import('@policylens/shared').PolicyAnalysis,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (analysis.provider) update.provider = analysis.provider;
  if (analysis.premium) {
    update.premium_amount = analysis.premium.amount;
    update.premium_currency = analysis.premium.currency;
  }
  if (typeof analysis.sumInsured === 'number') update.sum_insured = analysis.sumInsured;

  const { error } = await client.from(POLICIES_TABLE).update(update).eq('id', policyId);
  if (error) {
    throw new Error(`Failed to apply analysis fields to policy ${policyId}: ${error.message}`);
  }
}

/** Mark the job done at 100% progress. */
async function completeJob(client: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await client
    .from(JOBS_TABLE)
    .update({
      status: 'done',
      stage: 'done',
      progress: STAGE_PROGRESS.done,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  if (error) {
    throw new Error(`Failed to mark job ${jobId} done: ${error.message}`);
  }
}

/** Insert a completion notification for the policy owner (R16.3). */
async function notifyOwner(
  client: SupabaseClient,
  job: JobRow,
  policy: PolicyRow,
): Promise<void> {
  const { error } = await client.from(NOTIFICATIONS_TABLE).insert({
    user_id: job.owner_id,
    type: JOB_DONE_NOTIFICATION_TYPE,
    payload: {
      jobId: job.id,
      policyId: job.policy_id,
      filename: policy.original_filename ?? null,
      message: 'Your policy analysis is ready to view.',
    },
    read: false,
  });
  if (error) {
    throw new Error(`Failed to insert completion notification: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Failure handling (minimal — full semantics are task 6.2).
// ---------------------------------------------------------------------------

/**
 * Record a stage failure (R16.4): set `status=failed`, capture the
 * `failed_stage` and `error` message, and increment `attempts`. The job stays
 * in a terminal `failed` state until a user re-queues it via {@link retryJob}
 * (allowed while `attempts < maxAttempts`). The backing policy is marked
 * `failed` so the customer view can surface the error and a retry option.
 */
async function recordFailure(
  client: SupabaseClient,
  job: JobRow,
  failedStage: JobStage,
  message: string,
  logger: WorkerLogger,
): Promise<void> {
  const { error: jobError } = await client
    .from(JOBS_TABLE)
    .update({
      status: 'failed',
      failed_stage: failedStage,
      error: message,
      attempts: job.attempts + 1,
      queue_position: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  if (jobError) {
    logger.error(`[worker] failed to record job failure for ${job.id}: ${jobError.message}`);
  }

  const { error: policyError } = await client
    .from(POLICIES_TABLE)
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', job.policy_id);
  if (policyError) {
    logger.error(
      `[worker] failed to mark policy ${job.policy_id} failed: ${policyError.message}`,
    );
  }
}

/** Set the `extended` flag on a job for long (> 50-page) documents (R16.6). */
async function markExtended(client: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await client
    .from(JOBS_TABLE)
    .update({ extended: true, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) {
    throw new Error(`Failed to set extended flag on job ${jobId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Manual retry (R16.4).
// ---------------------------------------------------------------------------

/** Options for {@link retryJob}. */
export interface RetryJobOptions {
  /** Supabase client (defaults to the service-role client). */
  client?: SupabaseClient;
  /** Retry cap (defaults to `config.limits.jobMaxAttempts`, 3). */
  maxAttempts?: number;
  logger?: WorkerLogger;
}

/** Outcome of a {@link retryJob} request. */
export interface RetryJobResult {
  /** Whether the job was re-queued. */
  requeued: boolean;
  /**
   * Why a retry was refused, when `requeued` is false:
   *   • `not_found`     — no job with that id.
   *   • `not_failed`    — the job is not in a `failed` state.
   *   • `attempts_exhausted` — `attempts` has reached `maxAttempts`.
   */
  reason?: 'not_found' | 'not_failed' | 'attempts_exhausted';
  /** The job's attempt count (after failure accounting). */
  attempts?: number;
  /** The configured retry cap for convenience. */
  maxAttempts?: number;
}

/**
 * Re-queue a previously `failed` job for another pass (R16.4).
 *
 * A retry is only permitted while `attempts < maxAttempts` (default 3). On
 * success the job is reset to `queued` with a cleared stage/progress and the
 * `failed_stage`/`error` fields wiped; `attempts` is preserved (it was already
 * incremented at the time of failure) so the cap is enforced across retries.
 * The backing policy is returned to `uploaded` so it re-enters processing. The
 * worker loop then picks the job up subject to the per-user concurrency cap.
 */
export async function retryJob(
  jobId: string,
  options: RetryJobOptions = {},
): Promise<RetryJobResult> {
  const client = options.client ?? getSupabaseServiceRoleClient();
  const maxAttempts = options.maxAttempts ?? config.limits.jobMaxAttempts;
  const logger = options.logger ?? defaultLogger;

  const { data, error } = await client
    .from(JOBS_TABLE)
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job ${jobId} for retry: ${error.message}`);
  }

  const job = data as JobRow | null;
  if (!job) return { requeued: false, reason: 'not_found', maxAttempts };

  if (job.status !== 'failed') {
    return { requeued: false, reason: 'not_failed', attempts: job.attempts, maxAttempts };
  }

  if (job.attempts >= maxAttempts) {
    return {
      requeued: false,
      reason: 'attempts_exhausted',
      attempts: job.attempts,
      maxAttempts,
    };
  }

  // Conditional re-queue guarded on `status = 'failed'` to avoid racing a
  // concurrent retry / worker pickup.
  const { data: requeued, error: updateError } = await client
    .from(JOBS_TABLE)
    .update({
      status: 'queued',
      stage: 'queued',
      progress: STAGE_PROGRESS.queued,
      failed_stage: null,
      error: null,
      queue_position: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to re-queue job ${jobId}: ${updateError.message}`);
  }

  if (!requeued) {
    // Lost the race — the job is no longer `failed`.
    return { requeued: false, reason: 'not_failed', attempts: job.attempts, maxAttempts };
  }

  // Return the backing policy to `uploaded` so it re-enters the pipeline.
  const { error: policyError } = await client
    .from(POLICIES_TABLE)
    .update({ status: 'uploaded', updated_at: new Date().toISOString() })
    .eq('id', job.policy_id);
  if (policyError) {
    logger.error(
      `[worker] re-queued job ${jobId} but failed to reset policy ${job.policy_id}: ` +
        policyError.message,
    );
  }

  logger.info(`[worker] re-queued job ${jobId} (attempt ${job.attempts + 1}/${maxAttempts})`);
  return { requeued: true, attempts: job.attempts, maxAttempts };
}

/**
 * Wrap a pipeline step so a thrown error carries the stage it failed at. The
 * stage is read back off the error in {@link currentStageOf}.
 */
async function stageStep<T>(stage: JobStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    (err as { __stage?: JobStage }).__stage = stage;
    throw err;
  }
}

/** Recover the pipeline stage tagged onto an error, defaulting to `ocr`. */
function currentStageOf(err: unknown): JobStage {
  const tagged = (err as { __stage?: JobStage })?.__stage;
  return tagged ?? 'ocr';
}

/** Best-effort human-readable description of an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

// ---------------------------------------------------------------------------
// Poll loop.
// ---------------------------------------------------------------------------

/** Options for {@link startWorker}. */
export interface StartWorkerOptions {
  /** Poll interval in ms when the queue is empty (defaults to {@link DEFAULT_POLL_INTERVAL_MS}). */
  pollIntervalMs?: number;
  /** Injected dependencies (defaults to {@link createWorkerDeps}). */
  deps?: WorkerDeps;
}

/** Handle returned by {@link startWorker} so callers can stop the loop. */
export interface WorkerHandle {
  /** Stop the loop after the in-flight job (if any) settles. */
  stop(): void;
}

/**
 * Start the background worker poll loop. It processes jobs back-to-back while
 * the queue is non-empty, then sleeps `pollIntervalMs` before polling again.
 * The per-user concurrency cap (R16.7) is enforced at claim time, so even a
 * single-threaded drain never runs more than the allowed jobs per owner.
 *
 * Note: a future enhancement could process eligible jobs in parallel (still
 * bounded by the per-user cap) rather than the current one-at-a-time drain.
 */
export function startWorker(options: StartWorkerOptions = {}): WorkerHandle {
  const deps = options.deps ?? createWorkerDeps();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const logger = deps.logger ?? defaultLogger;

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    try {
      const result = await processNextJob(deps);
      // Drain continuously while there is work; otherwise back off and poll.
      if (result.outcome !== 'idle') {
        queueMicrotask(() => void loop());
        return;
      }
    } catch (err) {
      logger.error(`[worker] loop error: ${describeError(err)}`);
    }
    if (!stopped) {
      timer = setTimeout(() => void loop(), pollIntervalMs);
    }
  };

  logger.info(`[worker] started (poll every ${pollIntervalMs}ms)`);
  void loop();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info('[worker] stop requested');
    },
  };
}
