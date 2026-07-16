import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { GroundedAnswer } from '@policylens/shared';
import { api, ApiClientError } from '../lib/api';
import { CitedClauseChip } from './CitedClauseChip';

/**
 * ChatPanel — the conversational Q&A interface for a single policy (R5).
 *
 * The user types a plain-language question which is POSTed to
 * `POST /api/policies/:id/chat`. The returned {@link GroundedAnswer} is added
 * to the on-screen conversation:
 * - Grounded answers render the plain-English text plus cited-clause chips
 *   showing the supporting section and match % (R5.1, R5.2).
 * - Ungrounded answers (`groundedInPolicy === false`) are shown with a clear
 *   "not in your policy" treatment (R5.5 / R5.4).
 *
 * The question input is capped client-side at 500 characters with a live
 * counter so the user cannot exceed the backend limit (R5.7).
 */

/** Maximum question length enforced client-side (R5.7). */
export const MAX_QUESTION_LENGTH = 500;

interface ChatPanelProps {
  /** Policy id the chat is scoped to. */
  policyId: string;
}

/** A single turn in the rendered conversation. */
interface ChatTurn {
  id: number;
  question: string;
  answer: GroundedAnswer;
}

export function ChatPanel({ policyId }: ChatPanelProps) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const mutation = useMutation<GroundedAnswer, ApiClientError, string>({
    mutationFn: (q) => api.post<GroundedAnswer>(`/policies/${policyId}/chat`, { question: q }),
    onSuccess: (answer, q) => {
      setTurns((prev) => [...prev, { id: prev.length, question: q, answer }]);
      setQuestion('');
    },
  });

  const trimmed = question.trim();
  const remaining = MAX_QUESTION_LENGTH - question.length;
  const overLimit = question.length > MAX_QUESTION_LENGTH;
  const canSend = trimmed.length > 0 && !overLimit && !mutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend) {
      return;
    }
    mutation.mutate(trimmed);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Conversation transcript */}
      <div className="flex flex-col gap-4">
        {turns.length === 0 && !mutation.isPending && (
          <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center">
            <p className="font-display text-lg text-foreground">Ask about your policy</p>
            <p className="mt-1 text-sm text-muted">
              Ask a plain-language question like &ldquo;Does my policy cover knee
              replacement?&rdquo; and get an answer grounded in your document.
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-3">
            {/* User question bubble */}
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent/20 px-4 py-2.5 text-sm text-foreground">
                {turn.question}
              </p>
            </div>
            {/* Assistant answer bubble */}
            <AnswerBubble answer={turn.answer} />
          </div>
        ))}

        {mutation.isPending && (
          <div
            role="status"
            className="flex items-center gap-3 self-start rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3 text-sm text-muted"
          >
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
              aria-hidden
            />
            Reading your policy…
          </div>
        )}

        {mutation.isError && (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {mutation.error.message || 'Something went wrong. Please try asking again.'}
          </p>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-end">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your policy…"
            aria-label="Ask a question about your policy"
            rows={2}
            maxLength={MAX_QUESTION_LENGTH}
            className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div className="flex justify-end px-1">
          <span
            className={`text-xs ${overLimit ? 'text-danger' : 'text-muted'}`}
            aria-live="polite"
          >
            {remaining} / {MAX_QUESTION_LENGTH}
          </span>
        </div>
      </form>
    </div>
  );
}

/** Renders a single assistant answer, distinguishing grounded vs ungrounded. */
function AnswerBubble({ answer }: { answer: GroundedAnswer }) {
  // Ungrounded: the question couldn't be answered from the policy (R5.4/R5.5).
  if (!answer.groundedInPolicy) {
    return (
      <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-400">
          Not in your policy
        </p>
        <p className="mt-1 text-sm text-foreground">{answer.answer}</p>
      </div>
    );
  }

  return (
    <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3">
      <p className="text-sm leading-relaxed text-foreground">{answer.answer}</p>
      {answer.citedSections.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {answer.citedSections.map((citation, index) => (
            <CitedClauseChip key={`${citation.section}-${index}`} citation={citation} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ChatPanel;
