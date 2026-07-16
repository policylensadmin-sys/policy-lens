import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { PolicyAnalysis } from '@policylens/shared';
import { api, ApiClientError } from '../../lib/api';

/**
 * Guest single-policy preview (R17.3, R20.7).
 *
 * Lets an unauthenticated visitor upload one policy and see a simplified
 * analysis without creating an account. The file is POSTed as multipart to the
 * public `POST /try/analyze` endpoint (no bearer token; the endpoint is
 * ephemeral, rate-limited, and size-capped — backend task 7.8). The preview
 * surfaces the Health Score plus a few risk flags/exclusions and nudges the
 * visitor to sign up for the full analysis.
 */

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (R1.5)

type Status = 'idle' | 'processing' | 'done' | 'error';

/** Maps a Health Score to its quality band (R4.3). */
function scoreBand(score: number): string {
  if (score <= 40) return 'Poor';
  if (score <= 60) return 'Fair';
  if (score <= 80) return 'Good';
  return 'Excellent';
}

export function Try() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PolicyAnalysis | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file re-triggers change.
    event.target.value = '';
    if (!file) {
      return;
    }

    // Client-side guards mirroring the upload rules (R1.4, R1.5).
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus('error');
      setError('Unsupported format. Please upload a PDF, JPEG, or PNG file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus('error');
      setError('That file is larger than the 20 MB limit. Please upload a smaller file.');
      return;
    }

    setStatus('processing');
    setError(null);
    setAnalysis(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      // Public endpoint — send without a bearer token.
      const result = await api.post<PolicyAnalysis>('/try/analyze', formData, { auth: false });
      setAnalysis(result);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('We could not analyze that document right now. Please try again.');
      }
    }
  }

  function reset() {
    setStatus('idle');
    setError(null);
    setAnalysis(null);
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-accent">Try PolicyLens</h1>
        <p className="text-muted">
          Upload one policy for a free preview. No account needed. Results in under 40 seconds.
        </p>
      </div>

      {(status === 'idle' || status === 'error') && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="text-muted">Drop in a PDF, JPEG, or PNG (up to 20 MB).</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-accent px-5 py-2 font-medium text-background transition hover:opacity-90"
          >
            Choose a policy
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={handleFile}
          />
          {status === 'error' && error && (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {status === 'processing' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-10 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden />
          <p className="text-foreground">Analyzing your policy…</p>
          <p className="text-sm text-muted">Extracting text, then reviewing coverage and risks.</p>
        </div>
      )}

      {status === 'done' && analysis && <PreviewResult analysis={analysis} onReset={reset} />}
    </section>
  );
}

/** Simplified read-only preview of a guest analysis with a sign-up prompt. */
function PreviewResult({ analysis, onReset }: { analysis: PolicyAnalysis; onReset: () => void }) {
  const score = analysis.healthScore ?? 0;
  const riskFlags = analysis.hiddenClauses.slice(0, 3);
  const exclusions = analysis.exclusions.slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      {/* Health Score (R4.3) */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-6">
        <div>
          <p className="text-sm text-muted">Health Score</p>
          <p className="font-display text-4xl text-accent">{score}</p>
        </div>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-sm text-accent">
          {scoreBand(score)}
        </span>
      </div>

      {/* Risk flags preview */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-3 font-display text-lg text-foreground">
          {analysis.hiddenClauses.length} risk flag{analysis.hiddenClauses.length === 1 ? '' : 's'} found
        </h2>
        {riskFlags.length > 0 ? (
          <ul className="space-y-3">
            {riskFlags.map((clause, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                    clause.risk === 'High'
                      ? 'bg-danger/15 text-danger'
                      : clause.risk === 'Medium'
                        ? 'bg-accent/15 text-accent'
                        : 'bg-border/40 text-muted'
                  }`}
                >
                  {clause.risk}
                </span>
                <span className="text-sm text-muted">{clause.impact}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No risk flags were found in this policy.</p>
        )}
      </div>

      {/* Exclusions preview */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-3 font-display text-lg text-foreground">Top exclusions</h2>
        {exclusions.length > 0 ? (
          <ul className="space-y-3">
            {exclusions.map((exclusion, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-foreground">{exclusion.name}</p>
                <p className="text-sm text-muted">{exclusion.explanation}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No exclusions were found in this policy.</p>
        )}
      </div>

      {/* Sign-up prompt */}
      <div className="flex flex-col items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-6 text-center">
        <p className="text-foreground">
          This is a preview. Create a free account to see the full analysis, chat with your policy, and
          save it to your vault.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="rounded-md bg-accent px-5 py-2 font-medium text-background transition hover:opacity-90"
          >
            Sign up free
          </Link>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-border px-5 py-2 font-medium text-foreground transition hover:border-accent"
          >
            Try another policy
          </button>
        </div>
      </div>
    </div>
  );
}

export default Try;
