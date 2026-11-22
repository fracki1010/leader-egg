import { QueryClient } from '@tanstack/react-query';
import { ApiError, OfflineWriteQueuedError } from '../api/client.ts';
import { OfflineCacheMissError } from './offline-cache.ts';

// ─── Query defaults ─────────────────────────────────────────────────────────

/** Default freshness window for cached server state. */
export const QUERY_STALE_TIME_MS = 30_000;

/** Dashboard summary changes frequently (stock, cash) — refresh sooner. */
export const DASHBOARD_STALE_TIME_MS = 15_000;

/** Inactive queries are garbage-collected after 5 minutes. */
export const QUERY_GC_TIME_MS = 5 * 60_000;

/**
 * Retry policy:
 * - `OfflineWriteQueuedError` — the write is already queued locally, retrying
 *   would duplicate it. Never retry.
 * - `OfflineCacheMissError` — we are offline with no cached value; retrying
 *   cannot succeed. Never retry.
 * - `ApiError` 4xx — a client error; the same request will keep failing.
 *   Never retry.
 * - Anything else (5xx, network/timeout) — retry twice.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof OfflineWriteQueuedError) return false;
  if (error instanceof OfflineCacheMissError) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

/**
 * Create a QueryClient with the app's offline-first defaults.
 *
 * Queries use `networkMode: 'offlineFirst'` so TanStack never short-circuits a
 * query while offline — the api client performs an IndexedDB read-through
 * fallback that would be bypassed by the default `'online'` mode. Mutations use
 * `networkMode: 'always'` so the api client is allowed to run offline and queue
 * the write exactly once (the default `'offlineFirst'` would auto-resume and
 * risk duplicate queued writes).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
      },
      mutations: {
        networkMode: 'always',
        retry: 0,
      },
    },
  });
}

/** Application-wide QueryClient singleton. */
export const queryClient = createQueryClient();
