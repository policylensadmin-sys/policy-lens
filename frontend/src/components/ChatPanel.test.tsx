import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroundedAnswer } from '@policylens/shared';
import { ChatPanel, MAX_QUESTION_LENGTH } from './ChatPanel';
import { api } from '../lib/api';

/**
 * Tests for the chat panel (R5.1/R5.2 grounded answers + cited chips,
 * R5.5 ungrounded "not in your policy" state, R5.7 500-char cap).
 */
vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  ApiClientError: class ApiClientError extends Error {},
}));

const postMock = vi.mocked(api.post);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatPanel policyId="policy-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatPanel', () => {
  it('posts the question and renders the grounded answer with cited chips (R5.1/R5.2)', async () => {
    const answer: GroundedAnswer = {
      answer: 'Yes, knee replacement is covered under Section 4.',
      citedSections: [{ section: '4.2', match: 0.94 }],
      groundedInPolicy: true,
    };
    postMock.mockResolvedValueOnce(answer);

    renderPanel();
    fireEvent.change(screen.getByLabelText('Ask a question about your policy'), {
      target: { value: 'Does my policy cover knee replacement?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('Yes, knee replacement is covered under Section 4.')).not.toBeNull();
    });
    expect(postMock).toHaveBeenCalledWith('/policies/policy-1/chat', {
      question: 'Does my policy cover knee replacement?',
    });
    // Cited-clause chip present (R5.2)
    expect(screen.getByText('4.2')).not.toBeNull();
    expect(screen.getByText('94% match')).not.toBeNull();
  });

  it('shows a clear "not in your policy" state for ungrounded answers (R5.5)', async () => {
    postMock.mockResolvedValueOnce({
      answer: 'That information is not available in your uploaded policy.',
      citedSections: [],
      groundedInPolicy: false,
    } satisfies GroundedAnswer);

    renderPanel();
    fireEvent.change(screen.getByLabelText('Ask a question about your policy'), {
      target: { value: 'What is the capital of France?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('Not in your policy')).not.toBeNull();
    });
  });

  it('caps the input at 500 characters and shows a live counter (R5.7)', () => {
    renderPanel();
    const textarea = screen.getByLabelText('Ask a question about your policy') as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(MAX_QUESTION_LENGTH);
    expect(screen.getByText(`${MAX_QUESTION_LENGTH} / ${MAX_QUESTION_LENGTH}`)).not.toBeNull();

    fireEvent.change(textarea, { target: { value: 'a'.repeat(120) } });
    expect(screen.getByText(`${MAX_QUESTION_LENGTH - 120} / ${MAX_QUESTION_LENGTH}`)).not.toBeNull();
  });

  it('does not send an empty/whitespace-only question', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Ask a question about your policy'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(postMock).not.toHaveBeenCalled();
  });
});
