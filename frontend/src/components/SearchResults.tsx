import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { SearchResult } from '@policylens/shared';
import { api, ApiClientError } from '../lib/api';

/**
 * SearchResults — the semantic search panel for a policy (R15).
 *
 * Lets the user run a natural-language query against a single policy via
 * `POST /api/policies/:id/search`. Matching clauses are rendered in descending
 * order of match confidence, each showing the match percentage and the source
 * section (R15.3). When the query returns no clauses meeting the similarity
 * threshold, a helpful empty state suggests rephrasing (R15.5).
 */

interface SearchResultsProps {
  /** Policy id the search runs against. */
  policyId: string;
}

/**
 * Response shape for `POST /policies/:id/search`. The backend may return the
 * hits either as a bare array or wrapped in `{ results }`; both are accepted.
 */
type SearchResponse = SearchResult[] | { results: SearchResult[] };

function normalizeResults(payload: SearchResponse | undefined): SearchResult[] {
  if (!payload) {
    return [];
  }
  return Array.isArray(payload) ? payload : (payload.results ?? []);
}

/** Sort hits by match percentage, highest first (R15.3). */
function sortByMatchDesc(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => b.matchPercent - a.matchPercent);
}

export function SearchResults({ policyId }: SearchResultsProps) {
  const [query, setQuery] = useState('');

  const mutation = useMutation<SearchResult[], ApiClientError, string>({
    mutationFn: async (q) => {
      const payload = await api.post<SearchResponse>(`/policies/${policyId}/search`, { query: q });
      return sortByMatchDesc(normalizeResults(payload));
    },
  });

  const trimmed = query.trim();
  const canSearch = trimmed.length > 0 && !mutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSearch) {
      return;
    }
    mutation.mutate(trimmed);
  }

  const results = mutation.data ?? [];
  const hasSearched = mutation.isSuccess;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your policy, e.g. maternity waiting period"
          aria-label="Search your policy"
          className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!canSearch}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {mutation.isPending && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted"
        >
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
            aria-hidden
          />
          Searching your policy…
        </div>
      )}

      {mutation.isError && (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {mutation.error.message || 'Search failed. Please try again.'}
        </p>
      )}

      {/* No results meeting the similarity threshold (R15.5) */}
      {hasSearched && results.length === 0 && (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <p className="text-sm text-foreground">No relevant clauses found</p>
          <p className="mt-1 text-sm text-muted">
            Try rephrasing your query using different words or more detail.
          </p>
        </div>
      )}

      {/* Ranked results, highest match first (R15.3) */}
      {results.length > 0 && (
        <ul className="flex flex-col gap-3">
          {results.map((result) => (
            <li
              key={result.chunkIndex}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted">
                  {result.section?.trim() || `Chunk ${result.chunkIndex + 1}`}
                  {typeof result.page === 'number' ? ` · p.${result.page}` : ''}
                </span>
                <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                  {Math.round(result.matchPercent)}% match
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground">{result.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SearchResults;
