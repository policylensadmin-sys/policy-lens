import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PolicyAnalysis } from '@policylens/shared';

import {
  processNextJob,
  retryJob,
  STAGE_PROGRESS,
  EXTENDED_PAGE_THRESHOLD,
  JOB_DONE_NOTIFICATION_TYPE,
  type WorkerDeps,
} from '../src/worker/worker';
import type { ParserService, ExtractResult } from '../src/services/policy/parser';
import type { EmbeddingsService } from '../src/services/policy/embeddings';
import type { AnalysisService } from '../src/services/policy/analysis';

// ---------------------------------------------------------------------------
// In-memory fake Supabase client.
//
// Models only the chained query surface the worker actually uses:
//   from(t).select(cols).eq(col,val).order(col,{ascending})   → { data, error }
//   from(t).update(set).eq(...).select(cols).maybeSingle()    → { data, error }
//   from(t).insert(rows)                                      → { error }
//   from(t).upsert(rows,{onConflict})                         → { error }
//   from(t).select(cols).eq(col,val).maybeSingle()            → { data, error }
//   storage.from(bucket).download(path)                       → { data, error }
//
// Every builder is a thenable: awaiting it at any point runs the accumulated
// operation against the in-memory store and resolves with a Supabase-shaped
// `{ data?, error }` result. Writes are recorded in `_log` so tests can assert
// the exact sequence of job updates / inserts / upserts the worker performed.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Filter {
  col: string;
  val: unknown;
}

interface UpdateEntry {
  table: string;
  set: Row;
  filters: Filter[];
}

interface InsertEntry {
  table: string;
  rows: Row[];
}

class FakeQueryBuilder {
  private op: 'select' | 'update' | 'insert' | 'upsert' = 'select';
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private single = false;
  private orderCol: string | null = null;
  private orderAsc = true;
  private returnRows = false;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  select(_cols?: string): this {
    // A `.select()` after a write means "return the affected rows"; otherwise
    // it just marks this as a read.
    if (this.op === 'update' || this.op === 'insert' || this.op === 'upsert') {
      this.returnRows = true;
    } else {
      this.op = 'select';
    }
    return this;
  }

  update(payload: Row): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[], _options?: unknown): this {
    this.op = 'upsert';
    this.payload = payload;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }

  order(col: string, options?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = options?.ascending !== false;
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  // Thenable: awaiting the builder executes the accumulated operation.
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      return Promise.resolve(this.run()).then(onfulfilled ?? undefined, onrejected ?? undefined);
    } catch (err) {
      return Promise.reject(err).then(onfulfilled ?? undefined, onrejected ?? undefined) as Promise<
        TResult1 | TResult2
      >;
    }
  }

  private table_(): Row[] {
    return (this.client.store[this.table] ??= []);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => row[f.col] === f.val);
  }

  private run(): { data?: unknown; error: { message: string } | null } {
    const rows = this.table_();

    if (this.op === 'select') {
      let selected = rows.filter((r) => this.matches(r));
      if (this.orderCol) {
        const col = this.orderCol;
        const asc = this.orderAsc;
        selected = [...selected].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av < bv) return asc ? -1 : 1;
          if (av > bv) return asc ? 1 : -1;
          return 0;
        });
      }
      if (this.single) {
        return { data: selected[0] ? { ...selected[0] } : null, error: null };
      }
      return { data: selected.map((r) => ({ ...r })), error: null };
    }

    if (this.op === 'update') {
      const affected = rows.filter((r) => this.matches(r));
      const set = this.payload as Row;
      for (const r of affected) Object.assign(r, set);
      this.client.log.updates.push({
        table: this.table,
        set: { ...set },
        filters: [...this.filters],
      });
      if (this.returnRows) {
        if (this.single) {
          return { data: affected[0] ? { ...affected[0] } : null, error: null };
        }
        return { data: affected.map((r) => ({ ...r })), error: null };
      }
      return { error: null };
    }

    if (this.op === 'insert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const item of items) rows.push({ ...item });
      this.client.log.inserts.push({ table: this.table, rows: items.map((i) => ({ ...i })) });
      if (this.returnRows) return { data: items.map((i) => ({ ...i })), error: null };
      return { error: null };
    }

    // upsert (onConflict semantics are irrelevant for these tests — the worker
    // only ever writes a single analysis row per policy).
    const items = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    for (const item of items) rows.push({ ...item });
    this.client.log.upserts.push({ table: this.table, rows: items.map((i) => ({ ...i })) });
    return { error: null };
  }
}

interface StorageDownload {
  (path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message: string } | null }>;
}

class FakeSupabaseClient {
  readonly store: Record<string, Row[]>;
  readonly log: { updates: UpdateEntry[]; inserts: InsertEntry[]; upserts: InsertEntry[] } = {
    updates: [],
    inserts: [],
    upserts: [],
  };
  readonly storage: { from(bucket: string): { download: StorageDownload } };

  constructor(initial: Record<string, Row[]>, download?: StorageDownload) {
    this.store = {
      jobs: [],
      policies: [],
      policy_analysis: [],
      policy_chunks: [],
      notifications: [],
      ...initial,
    };
    const defaultDownload: StorageDownload = async () => ({
      data: { arrayBuffer: async () => new ArrayBuffer(16) },
      error: null,
    });
    const dl = download ?? defaultDownload;
    this.storage = { from: () => ({ download: dl }) };
  }

  from(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
  }

  /** Job-table updates that carried a `stage`, as ordered `{stage, progress}` pairs. */
  stageProgressLog(): Array<{ stage: unknown; progress: unknown }> {
    return this.log.updates
      .filter((u) => u.table === 'jobs' && 'stage' in u.set)
      .map((u) => ({ stage: u.set.stage, progress: u.set.progress }));
  }

  jobRow(id: string): Row | undefined {
    return this.store.jobs.find((j) => j.id === id);
  }

  policyRow(id: string): Row | undefined {
    return this.store.policies.find((p) => p.id === id);
  }
}

// ---------------------------------------------------------------------------
// Fake pipeline services (injected via WorkerDeps).
// ---------------------------------------------------------------------------

const validAnalysis: PolicyAnalysis = {
  provider: 'Acme Health',
  premium: { amount: 12000, currency: 'INR' },
  sumInsured: 500000,
  coverage: [{ type: 'Hospitalization', detail: 'In-patient care', covered: true }],
  exclusions: [],
  waitingPeriods: [],
  financialLimits: [],
  coPay: [],
  deductibles: [],
  hiddenClauses: [],
  recommendations: [],
  healthScore: 82,
  riskFlagCount: 0,
  notFound: [],
  partial: false,
};

function makeParser(pageCount: number): ParserService {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    page: i + 1,
    text: `Page ${i + 1} of the policy document with enough text to chunk.`,
  }));
  const result: ExtractResult = {
    text: pages.map((p) => p.text).join('\n\n'),
    pages,
    usedOcr: false,
  };
  return { extract: async () => result } as unknown as ParserService;
}

function makeEmbeddings(): EmbeddingsService {
  return { embedAndStore: async () => undefined } as unknown as EmbeddingsService;
}

function makeAnalysis(analysis: PolicyAnalysis = validAnalysis): AnalysisService {
  return { analyze: async () => analysis } as unknown as AnalysisService;
}

function makeDeps(client: FakeSupabaseClient, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
  return {
    client: client as unknown as SupabaseClient,
    parser: overrides.parser ?? makeParser(3),
    embeddings: overrides.embeddings ?? makeEmbeddings(),
    analysis: overrides.analysis ?? makeAnalysis(),
    bucket: 'policies',
    maxAttempts: overrides.maxAttempts ?? 3,
    concurrencyPerUser: overrides.concurrencyPerUser ?? 5,
    logger: overrides.logger ?? silentLogger,
  };
}

function queuedJob(overrides: Partial<Row> = {}): Row {
  return {
    id: 'job-1',
    owner_id: 'owner-1',
    policy_id: 'policy-1',
    type: 'analyze',
    status: 'queued',
    stage: null,
    progress: 0,
    queue_position: null,
    attempts: 0,
    extended: false,
    created_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function policyRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'policy-1',
    owner_id: 'owner-1',
    storage_path: 'owner-1/policy-1.pdf',
    mime_type: 'application/pdf',
    original_filename: 'policy.pdf',
    status: 'uploaded',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage/progress transitions — R16.2, R16.3
// ---------------------------------------------------------------------------

describe('processNextJob — stage/progress pipeline', () => {
  it('drives a queued job queued(0) → ocr(25) → embedding(55) → analysis(80) → done(100)', async () => {
    const client = new FakeSupabaseClient({
      jobs: [queuedJob()],
      policies: [policyRow()],
    });

    const result = await processNextJob(makeDeps(client));

    expect(result.outcome).toBe('done');
    expect(result.jobId).toBe('job-1');

    // The recorded job stage/progress updates arrive in pipeline order (R16.2).
    expect(client.stageProgressLog()).toEqual([
      { stage: 'queued', progress: STAGE_PROGRESS.queued },
      { stage: 'ocr', progress: STAGE_PROGRESS.ocr },
      { stage: 'embedding', progress: STAGE_PROGRESS.embedding },
      { stage: 'analysis', progress: STAGE_PROGRESS.analysis },
      { stage: 'done', progress: STAGE_PROGRESS.done },
    ]);

    // Terminal job state.
    const job = client.jobRow('job-1')!;
    expect(job.status).toBe('done');
    expect(job.stage).toBe('done');
    expect(job.progress).toBe(100);
  });

  it('marks the policy analyzed and inserts a completion notification (R16.3)', async () => {
    const client = new FakeSupabaseClient({
      jobs: [queuedJob()],
      policies: [policyRow()],
    });

    await processNextJob(makeDeps(client));

    // Policy is marked analyzed at the end of the pipeline.
    expect(client.policyRow('policy-1')!.status).toBe('analyzed');

    // Structured analysis was persisted.
    expect(client.store.policy_analysis).toHaveLength(1);
    expect(client.store.policy_analysis[0]!.policy_id).toBe('policy-1');

    // A completion notification was inserted for the policy owner (R16.3).
    expect(client.store.notifications).toHaveLength(1);
    const notification = client.store.notifications[0]!;
    expect(notification.user_id).toBe('owner-1');
    expect(notification.type).toBe(JOB_DONE_NOTIFICATION_TYPE);
    expect((notification.payload as Row).jobId).toBe('job-1');
  });

  it('returns idle when there is no queued job', async () => {
    const client = new FakeSupabaseClient({ jobs: [], policies: [] });

    const result = await processNextJob(makeDeps(client));

    expect(result.outcome).toBe('idle');
    expect(client.log.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Retry cap — R16.4
// ---------------------------------------------------------------------------

describe('retryJob — retry cap of 3 (R16.4)', () => {
  it('re-queues a failed job while attempts remain below the cap', async () => {
    const client = new FakeSupabaseClient({
      jobs: [queuedJob({ status: 'failed', attempts: 1, failed_stage: 'ocr', error: 'boom' })],
      policies: [policyRow({ status: 'failed' })],
    });

    const result = await retryJob('job-1', {
      client: client as unknown as SupabaseClient,
      maxAttempts: 3,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.requeued).toBe(true);
    expect(result.reason).toBeUndefined();

    // Job reset to queued; policy returned to uploaded so it re-enters processing.
    const job = client.jobRow('job-1')!;
    expect(job.status).toBe('queued');
    expect(job.stage).toBe('queued');
    expect(job.progress).toBe(STAGE_PROGRESS.queued);
    expect(job.failed_stage).toBeNull();
    expect(job.error).toBeNull();
    expect(client.policyRow('policy-1')!.status).toBe('uploaded');
  });

  it("refuses with reason 'attempts_exhausted' once attempts reach the cap (3)", async () => {
    const client = new FakeSupabaseClient({
      jobs: [queuedJob({ status: 'failed', attempts: 3, failed_stage: 'analysis' })],
      policies: [policyRow({ status: 'failed' })],
    });

    const result = await retryJob('job-1', {
      client: client as unknown as SupabaseClient,
      maxAttempts: 3,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.requeued).toBe(false);
    expect(result.reason).toBe('attempts_exhausted');
    expect(result.attempts).toBe(3);
    expect(result.maxAttempts).toBe(3);

    // The job is untouched — still failed.
    expect(client.jobRow('job-1')!.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Extended flag — R16.6
// ---------------------------------------------------------------------------

describe('processNextJob — extended flag for long documents (R16.6)', () => {
  it('sets extended=true when the parser returns more than the page threshold', async () => {
    const client = new FakeSupabaseClient({
      jobs: [queuedJob()],
      policies: [policyRow()],
    });

    const deps = makeDeps(client, { parser: makeParser(EXTENDED_PAGE_THRESHOLD + 1) });
    const result = await processNextJob(deps);

    expect(result.outcome).toBe('done');
    expect(client.jobRow('job-1')!.extended).toBe(true);
    // The extended flag was written as its own update.
    expect(
      client.log.updates.some((u) => u.table === 'jobs' && u.set.extended === true),
    ).toBe(true);
  });

  it('leaves extended=false for a document at or below the threshold', async () => {
    const client = new FakeSupabaseClient({
      jobs: [queuedJob()],
      policies: [policyRow()],
    });

    const deps = makeDeps(client, { parser: makeParser(EXTENDED_PAGE_THRESHOLD) });
    await processNextJob(deps);

    expect(client.jobRow('job-1')!.extended).toBe(false);
    expect(
      client.log.updates.some((u) => u.table === 'jobs' && u.set.extended === true),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Concurrency cap + queueing — R16.7
// ---------------------------------------------------------------------------

describe('processNextJob — per-user concurrency cap (R16.7)', () => {
  it('does not claim an owner already at the concurrency cap and computes queue_position', async () => {
    const client = new FakeSupabaseClient({
      jobs: [
        // Owner already running at the cap (concurrencyPerUser = 1).
        queuedJob({
          id: 'running-1',
          owner_id: 'owner-1',
          status: 'running',
          stage: 'ocr',
          progress: 25,
          created_at: '2024-01-01T00:00:00.000Z',
        }),
        // Their waiting job must stay queued behind the cap.
        queuedJob({
          id: 'waiting-1',
          owner_id: 'owner-1',
          policy_id: 'policy-1',
          created_at: '2024-01-01T00:01:00.000Z',
        }),
      ],
      policies: [policyRow()],
    });

    const result = await processNextJob(makeDeps(client, { concurrencyPerUser: 1 }));

    // No eligible job → idle, and the capped owner's job is left queued.
    expect(result.outcome).toBe('idle');
    const waiting = client.jobRow('waiting-1')!;
    expect(waiting.status).toBe('queued');
    // First (and only) overflow job for the owner → queue_position 1.
    expect(waiting.queue_position).toBe(1);
  });

  it('skips the capped owner and claims a different owner whose slot is free', async () => {
    const client = new FakeSupabaseClient({
      jobs: [
        queuedJob({
          id: 'running-a',
          owner_id: 'owner-a',
          status: 'running',
          created_at: '2024-01-01T00:00:00.000Z',
        }),
        // Owner A overflow (earliest queued) — must be skipped.
        queuedJob({
          id: 'waiting-a',
          owner_id: 'owner-a',
          policy_id: 'policy-a',
          created_at: '2024-01-01T00:01:00.000Z',
        }),
        // Owner B has a free slot — should be claimed and processed.
        queuedJob({
          id: 'waiting-b',
          owner_id: 'owner-b',
          policy_id: 'policy-b',
          created_at: '2024-01-01T00:02:00.000Z',
        }),
      ],
      policies: [
        policyRow({ id: 'policy-a', owner_id: 'owner-a', storage_path: 'owner-a/a.pdf' }),
        policyRow({ id: 'policy-b', owner_id: 'owner-b', storage_path: 'owner-b/b.pdf' }),
      ],
    });

    const result = await processNextJob(makeDeps(client, { concurrencyPerUser: 1 }));

    expect(result.outcome).toBe('done');
    expect(result.jobId).toBe('waiting-b');

    // Owner A's overflow job stays queued with a computed position.
    const waitingA = client.jobRow('waiting-a')!;
    expect(waitingA.status).toBe('queued');
    expect(waitingA.queue_position).toBe(1);

    // Owner B's job ran to completion.
    expect(client.jobRow('waiting-b')!.status).toBe('done');
  });
});
