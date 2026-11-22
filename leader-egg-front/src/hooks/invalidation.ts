import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, type QueryDomain } from './query-keys.ts';

/**
 * Invalidate one or more whole query domains by prefix.
 *
 * Uses each domain's `all` root so every list/detail query in that domain is
 * marked stale. Fire-and-forget — callers do not need to await invalidation.
 */
export function invalidateDomains(
  queryClient: QueryClient,
  domains: readonly QueryDomain[],
): void {
  for (const domain of domains) {
    void queryClient.invalidateQueries({ queryKey: queryKeys[domain].all });
  }
}
