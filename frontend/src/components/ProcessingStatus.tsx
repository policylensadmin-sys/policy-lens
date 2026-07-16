import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Job, JobStage } from '@policylens/shared';
import { api } from '../lib/api';

/**
 * Background-processing status view (R1.6, R1.7, R1.8, R16.2).
 *
 * Polls `GET /jobs/:id` every 2 seconds (design: Background Processing
 * Pipeline) and renders the four-step pipeline — Upload → Extract → Analyze →
 * Done — with a progress bar. When the job completes it invokes
 * `onComplete(policyId)` so the parent can route to the policy dashboard. On
 * failure it surfaces the failed stage + error and a Retry action (R1.7). If
 * the job neither completes nor fails within 120 seconds it shows a timeout
 * message and the same Retry action (R1.8).
 */

/** Poll interval for the job status query (2s, R16.2). */
export const POLL_INTERVAL_MS = 2_000;

/** Client-side processing timeout before we surface a retry (120s, R1.8). */
export const PROCESSING_TIMEOUT_MS = 120_000;

/** The four user-facing pipeline steps (R1.6). */
const PIPELINE_STEPS = ['Upload', 'Extract', 'Analyze', 'Done'] as const;
type StepState = 'done' | 'active' | 'pending';

/**
 * Maps a backend {@link JobStage} to the index of the active step in the
 * user-facing four-step pipeline. The pipeline collapses the backend
 * `embedding` and `analysis` stages into a single "Analyze" step (R16.2).
 */
function stageToStepIndex(stage: JobStage): number {
  switch (stage) {
    case 'queued':
      return 0; // Upload
    case 'ocr':
      return 1; // Extract
    case 'embedding':
    case 'analysis':
      return 2; // Analyze
    case 'done':
      return 3; // Done
    default:
      return 0;
  }
}

interface ProcessingStatusProps {
  /** The processing job id to poll. */
  jobId: string;
  /** Policy id to hand back on completion so the parent can navigate. */
  policyId: string;
  /** Called once when the job reaches `done`. */
  onComplete: (policyId: string) => void;
  /** Called when the user chooses to retry after a failure or timeout. */
  onRetry: () => void;
}

export function ProcessingStatus({
  jobId,
  policyId,
  onComplete,
  onRetry,
}: ProcessingStatusProps) {
  const [timedOut, setTimedOut] = useState(false);
  const completedRef = useRef(false);

  const { data: job, error } = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    // Stop polling once the job is settled or the client timed out (R16.2).
    refetchInterval: (query) => {
      const current = query.state.data;
      if (timedOut || current?.status === 'done' || current?.status === 'failed') {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
    refetchOnWindowFocus: false,
  });

  const isFailed = job?.status === 'failed';
  const isDone = job?.status === 'done';

  // Start a single 120s timeout window; clear it once the job settles (R1.8).
  useEffect(() => {
    if (isDone || isFailed) {
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), PROCESSING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isDone, isFailed]);

  // Navigate to the dashboard exactly once on completion (R1.6 → R4).
  useEffect(() => {
    if (isDone && !completedRef.current) {
      completedRef.current = true;
      onComplete(policyId);
    }
  }, [isDone, policyId, onComplete]);

  // Timeout state takes precedence — the job may still be stuck queued/running.
  if (timedOut && !isDone && !isFailed) {
    return (
      <StatusCard
        tone="warn"
        heading="This is taking longer than expected"
        message="Your policy hasn't finished processing within 120 seconds. You can retry the upload."
        onRetry={onRetry}
      />
    );
  }

  // Failure state — show the failed stage and reason with a retry (R1.7).
  if (isFailed) {
    const failedAt = job?.failedStage ? ` during the ${job.failedStage} stage` : '';
    return (
      <StatusCard
        tone="error"
        heading="Processing failed"
        message={`${job?.error ?? 'Something went wrong while processing your policy'}${failedAt}.`}
        onRetry={onRetry}
      />
    );
  }

  // A query-level error (e.g. network) — allow a retry too.
  if (error && !job) {
    return (
      <StatusCard
        tone="error"
        heading="Couldn't check processing status"
        message="We lost connection while checking your policy's progress. Please retry."
        onRetry={onRetry}
      />
    );
  }

  const activeIndex = job ? stageToStepIndex(job.stage) : 0;
  const progress = job?.progress ?? 0;

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6">
      <div className="space-y-1">
        <h2 className="font-display text-lg text-foreground">Analyzing your policy</h2>
        <p className="text-sm text-muted">
          {job?.extended
            ? 'This is a large document, so processing may take a little longer.'
            : 'You can keep using PolicyLens while we work — results in under 40 seconds.'}
        </p>
        {typeof job?.queuePosition === 'number' && job.queuePosition > 0 && (
          <p className="text-sm text-muted">
            In queue — position {job.queuePosition}.
          </p>
        )}
      </div>

      {/* Stage pipeline: Upload → Extract → Analyze → Done (R1.6) */}
      <ol className="flex items-center justify-between gap-2" aria-label="Processing stages">
        {PIPELINE_STEPS.map((label, index) => {
          const state: StepState =
            index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-2 text-center">
              <span
                aria-current={state === 'active' ? 'step' : undefined}
                className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm ${
                  state === 'done'
                    ? 'border-accent bg-accent text-background'
                    : state === 'active'
                      ? 'border-accent text-accent'
                      : 'border-border text-muted'
                }`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span
                className={`text-xs ${state === 'pending' ? 'text-muted' : 'text-foreground'}`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Progress bar tied to the job's reported progress. */}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

interface StatusCardProps {
  tone: 'error' | 'warn';
  heading: string;
  message: string;
  onRetry: () => void;
}

/** Terminal error/timeout card with a retry action (R1.7, R1.8). */
function StatusCard({ tone, heading, message, onRetry }: StatusCardProps) {
  const toneClasses =
    tone === 'error' ? 'border-danger/40 bg-danger/10' : 'border-accent/40 bg-accent/5';
  return (
    <div className={`flex flex-col items-center gap-4 rounded-xl border p-8 text-center ${toneClasses}`}>
      <h2 className="font-display text-lg text-foreground">{heading}</h2>
      <p role="alert" className="text-sm text-muted">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background transition hover:opacity-90"
      >
        Retry upload
      </button>
    </div>
  );
}

export default ProcessingStatus;
