import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { GroundedAnswer } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';
import { AskLensLabel, LensSparkle } from '../Brand';

/**
 * "Ask Lens" — an interactive AI chat card for the broker AI Assistant page.
 *
 * The broker types a free-text question and gets an answer grounded in their
 * own portfolio (recent AI insights + a portfolio summary) via
 * `POST /api/broker/assistant`. Messages live in local component state only
 * (no persistence). The 500-char cap mirrors the backend limit.
 *
 * Fully responsive: the card, message list, and composer stack and stretch to
 * full width on small screens with no horizontal overflow.
 */

/** Max question length — mirrors the backend cap (R5.7). */
const MAX_QUESTION_LENGTH = 500;

/** A single chat message held in local state. */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Cited portfolio sections returned with an assistant answer, if any. */
  citedSections?: GroundedAnswer['citedSections'];
}

/** Generate a stable-enough id for a local message. */
function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AskLens() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message (and the "thinking" indicator) in view.
  useEffect(() => {
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, loading]);

  const trimmed = input.trim();
  const overLimit = input.length > MAX_QUESTION_LENGTH;
  const canSend = trimmed.length > 0 && !overLimit && !loading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;

    const question = trimmed;
    const userMessage: ChatMessage = { id: messageId(), role: 'user', text: question };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const answer = await api.post<GroundedAnswer>('/broker/assistant', { question });
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: 'assistant',
          text: answer.answer,
          citedSections: answer.citedSections,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <span className="inline-flex items-center gap-2 font-display text-base font-semibold text-slate-900">
          <LensSparkle className="h-5 w-5" />
          <span>
            Ask <span className="text-[#2563EB]">Lens</span>
          </span>
        </span>
        <span className="ml-auto hidden text-xs text-slate-400 sm:block">
          Grounded in your portfolio
        </span>
      </header>

      {/* Message list */}
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Ask Lens conversation"
        className="flex max-h-80 min-h-[8rem] flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5"
      >
        {messages.length === 0 && !loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <LensSparkle className="h-6 w-6" />
            <p className="text-sm text-slate-500">
              Ask about your clients, renewals, coverage gaps, or portfolio trends.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <SuggestionChip key={s} text={s} onPick={setInput} disabled={loading} />
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}

        {loading && (
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-500">
            <LensSparkle className="h-4 w-4 animate-pulse" />
            <span>Lens is thinking…</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="px-4 pb-1 text-sm text-rose-600 sm:px-5">
          {error}
        </p>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-end sm:px-5"
      >
        <div className="flex flex-1 flex-col">
          <label htmlFor="ask-lens-input" className="sr-only">
            Ask Lens a question
          </label>
          <textarea
            id="ask-lens-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) {
                  void handleSubmit(e as unknown as FormEvent<HTMLFormElement>);
                }
              }
            }}
            rows={2}
            maxLength={MAX_QUESTION_LENGTH + 100}
            placeholder="Ask Lens about your portfolio…"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
          <span
            className={`mt-1 text-right text-[11px] ${
              overLimit ? 'text-rose-600' : 'text-slate-400'
            }`}
          >
            {input.length}/{MAX_QUESTION_LENGTH}
          </span>
        </div>
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex w-full items-center justify-center rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <AskLensLabel />
        </button>
      </form>
    </section>
  );
}

/** Starter prompts shown in the empty state. */
const SUGGESTIONS = [
  'Which clients need a renewal soon?',
  'Where are my biggest coverage gaps?',
  'Summarize my portfolio performance.',
];

/** A clickable suggestion chip that pre-fills the composer. */
function SuggestionChip({
  text,
  onPick,
  disabled,
}: {
  text: string;
  onPick: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(text)}
      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-50"
    >
      {text}
    </button>
  );
}

/** A single user or assistant chat bubble. */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? 'rounded-br-sm bg-[#2563EB] text-white'
            : 'rounded-bl-sm bg-slate-100 text-slate-800'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        {!isUser && message.citedSections && message.citedSections.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citedSections.map((cited, index) => (
              <span
                key={`${cited.section}-${index}`}
                className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500"
              >
                {cited.section}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AskLens;
