import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Job, JobStage, JobStatus } from '@policylens/shared';
import { ProcessingStatus } from './ProcessingStatus';

/**
 * Tests for the processing status pipeline (R1.6, R1.7, R16.2).
 *
 * The `/jobs/:id` API call is mocked so each test controls the job the
 * component polls; polling itself is not exercised (a single resolved value
 * is enough to assert stage rendering and terminal states).
 */
vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}));
import { api } from '../lib/api';

const mockGet = api.get as unknown as Mock;

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    ownerId: 'owner-1',
    policyId: 'policy-1',
    type: 'analyze',
    status: 'running' as JobStatus,
    stage: 'ocr' as JobStage,
    progress: 25,
    attempts: 0,
    extended: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderStatus(job: Job, handlers: { onComplete?: Mock; onRetry?: Mock } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <ProcessingStatus
      jobId={job.id}
      policyId={job.policyId}
      onComplete={handlers.onComplete ?? vi.fn()}
      onRetry={handlers.onRetry ?? vi.fn()}
    />,
    { wrapper },
  );
}

describe('ProcessingStatus', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('renders the four-step pipeline with progress (R1.6, R16.2)', async () => {
    mockGet.mockResolvedValue(makeJob({ stage: 'ocr', progress: 25 }));
    renderStatus(makeJob({ stage: 'ocr', progress: 25 }));

    await waitFor(() => {
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    });
    expect(screen.queryByText('Upload')).not.toBeNull();
    expect(screen.queryByText('Extract')).not.toBeNull();
    expect(screen.queryByText('Analyze')).not.toBeNull();
    expect(screen.queryByText('Done')).not.toBeNull();
  });

  it('shows the failed stage and reason with a retry action (R1.7)', async () => {
    const onRetry = vi.fn();
    mockGet.mockResolvedValue(
      makeJob({ status: 'failed', failedStage: 'analysis', error: 'AI provider error' }),
    );
    renderStatus(makeJob({ status: 'failed' }), { onRetry });

    await waitFor(() => {
      expect(screen.queryByText('Processing failed')).not.toBeNull();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/AI provider error/);
    expect(screen.getByRole('alert').textContent).toMatch(/analysis stage/);

    fireEvent.click(screen.getByRole('button', { name: /retry upload/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('invokes onComplete with the policy id when the job is done (R1.6)', async () => {
    const onComplete = vi.fn();
    mockGet.mockResolvedValue(
      makeJob({ status: 'done', stage: 'done', progress: 100, policyId: 'policy-42' }),
    );
    renderStatus(makeJob({ policyId: 'policy-42' }), { onComplete });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('policy-42');
    });
  });
});
