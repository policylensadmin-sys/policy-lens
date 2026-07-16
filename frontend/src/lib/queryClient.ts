import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack React Query client for all server-state (queries + mutations).
 *
 * Defaults tuned for the PolicyLens data-fetching patterns described in the
 * Frontend Design (State Management): a short stale time so dashboards stay
 * fresh, a single retry (the API client already surfaces typed errors), and no
 * refetch-on-focus to avoid noisy re-fetches. Per-query overrides (e.g. the 2s
 * job-status polling and ≤60s dashboard refetch interval) are supplied at the
 * call sites in later tasks.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
