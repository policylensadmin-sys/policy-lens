import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { Job } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';
import { UploadDropzone } from '../../components/UploadDropzone';
import { ProcessingStatus } from '../../components/ProcessingStatus';

/**
 * Customer upload + processing screen (R1).
 *
 * Flow:
 * 1. {@link UploadDropzone} validates the file client-side (format + 20 MB cap)
 *    and hands back a valid `File`.
 * 2. A React Query mutation POSTs the file as multipart to `POST /api/policies`
 *    (authenticated). The backend stores the file, creates the policy + job,
 *    and returns a job acknowledgment carrying the new policy id (R1.1–R1.3,
 *    R16.1).
 * 3. {@link ProcessingStatus} polls `GET /api/jobs/:id` (2s) to drive the
 *    Upload → Extract → Analyze → Done pipeline, then routes to the policy
 *    dashboard on completion, or offers a retry on failure/timeout (R1.6–R1.8).
 */

/**
 * Upload acknowledgment returned by `POST /policies`. The shared {@link Job}
 * already carries `policyId`, so a single job object gives us everything we
 * need to start polling and to route on completion. We also accept a bare
 * `Job` for forward-compatibility with the backend contract (task 7.1).
 */
interface UploadAck {
  job: Job;
}

function normalizeAck(payload: UploadAck | Job): Job {
  return 'job' in payload ? payload.job : payload;
}

type Phase = 'select' | 'uploading' | 'processing';

export function Upload() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadMutation = useMutation<Job, unknown, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const ack = await api.post<UploadAck | Job>('/policies', formData);
      return normalizeAck(ack);
    },
    onMutate: () => {
      setUploadError(null);
      setPhase('uploading');
    },
    onSuccess: (acceptedJob) => {
      setJob(acceptedJob);
      setPhase('processing');
    },
    onError: (error) => {
      setPhase('select');
      if (error instanceof ApiClientError) {
        setUploadError(error.message);
      } else {
        setUploadError('We could not upload that file right now. Please try again.');
      }
    },
  });

  const handleFileSelected = useCallback(
    (file: File) => {
      setSelectedFile(file);
      uploadMutation.mutate(file);
    },
    [uploadMutation],
  );

  // Retry re-uploads the same file, creating a fresh job (R1.7, R1.8).
  const handleRetry = useCallback(() => {
    setJob(null);
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    } else {
      setPhase('select');
    }
  }, [selectedFile, uploadMutation]);

  const handleComplete = useCallback(
    (policyId: string) => {
      navigate(`/app/policy/${policyId}`);
    },
    [navigate],
  );

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl text-accent">Upload a policy</h1>
        <p className="text-muted">
          Upload your insurance document and we&apos;ll extract, analyze, and score it for you.
        </p>
      </div>

      {(phase === 'select' || phase === 'uploading') && (
        <>
          <UploadDropzone onFileSelected={handleFileSelected} disabled={phase === 'uploading'} />
          {phase === 'uploading' && (
            <div
              role="status"
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted"
            >
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
                aria-hidden
              />
              Uploading{selectedFile ? ` ${selectedFile.name}` : ''}…
            </div>
          )}
          {uploadError && (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {uploadError}
            </p>
          )}
        </>
      )}

      {phase === 'processing' && job && (
        <ProcessingStatus
          jobId={job.id}
          policyId={job.policyId}
          onComplete={handleComplete}
          onRetry={handleRetry}
        />
      )}
    </section>
  );
}

export default Upload;
