// Background processing job (mirrors the `jobs` table, R16).

import type { JobStage, JobStatus } from './enums.js';
import type { Timestamp } from './common.js';

/** A background job that processes an uploaded policy through the pipeline. */
export interface Job {
  id: string;
  ownerId: string;
  policyId: string;
  type: string;
  status: JobStatus;
  stage: JobStage;
  /** 0–100 progress value tied to the current stage. */
  progress: number;
  /** Position in the per-user queue when concurrency cap is exceeded (R16.7). */
  queuePosition?: number | null;
  attempts: number;
  /** Stage at which processing failed, if any (R16.4). */
  failedStage?: JobStage | null;
  error?: string | null;
  /** True for documents that exceed the extended-processing page threshold (R16.6). */
  extended: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
