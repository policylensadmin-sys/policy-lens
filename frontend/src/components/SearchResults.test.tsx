import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchResult } from '@policylens/shared';
import { SearchResults } from './SearchResults';
import { api } from '../lib/api';

/**
 * Tests for the semantic search panel (R15.3 ranked by match % desc,
 * R15.5 empty state when no clauses meet the threshold).
 */
vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  ApiClientError: class ApiClientError extends Error {},
}));

const postMock = vi.mocked(api.post);

function result(chunkIndex: number, matchPercent: number, section: string): SearchResult {
  return { chunkIndex, matchPercent, section, content: `Clause ${chunkIndex}`, page: 1 };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchResults policyId="policy-1" />
    </QueryClientProvider>,
  );
}

function runSearch(query: string) {
  fireEvent.change(screen.getByLabelText('Search your policy'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SearchResults', () => {
  it('lists results in descending order of match % (R15.3)', async () => {
    // Returned out of order — component must sort desc.
    postMock.mockResolvedValueOnce([
      result(1, 72, '3.1'),
      result(2, 95, '4.2'),
      result(3, 80, '2.0'),
    ]);

    renderPanel();
    runSearch('maternity waiting period');

    await waitFor(() => {
      expect(screen.getByText('95% match')).not.toBeNull();
    });

    const matches = screen.getAllByText(/% match$/).map((el) => el.textContent);
    expect(matches).toEqual(['95% match', '80% match', '72% match']);
    expect(postMock).toHaveBeenCalledWith('/policies/policy-1/search', {
      query: 'maternity waiting period',
    });
  });

  it('accepts a { results } wrapper response shape', async () => {
    postMock.mockResolvedValueOnce({ results: [result(1, 88, '5.0')] });

    renderPanel();
    runSearch('co-payment');

    await waitFor(() => {
      expect(screen.getByText('88% match')).not.toBeNull();
    });
  });

  it('shows an empty state when no clauses are found (R15.5)', async () => {
    postMock.mockResolvedValueOnce([]);

    renderPanel();
    runSearch('something unrelated');

    await waitFor(() => {
      expect(screen.getByText('No relevant clauses found')).not.toBeNull();
    });
    expect(
      screen.getByText('Try rephrasing your query using different words or more detail.'),
    ).not.toBeNull();
  });

  it('does not search on an empty query', () => {
    renderPanel();
    runSearch('   ');
    expect(postMock).not.toHaveBeenCalled();
  });
});
