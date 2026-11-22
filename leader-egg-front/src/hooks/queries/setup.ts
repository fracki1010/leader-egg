import { useQuery } from '@tanstack/react-query';
import { setupApi } from '../../api/setup.ts';
import { queryKeys } from '../query-keys.ts';

/**
 * Current punto-cero setup state (defaults before any POST).
 *
 * `enabled` lets callers skip the request for roles that cannot read the
 * endpoint (it requires `config.manage`) while still keeping hook order stable.
 */
export function usePuntoCero(enabled = true) {
  return useQuery({
    queryKey: queryKeys.setup.puntoCero(),
    queryFn: () => setupApi.getPuntoCero(),
    enabled,
  });
}

/**
 * The tenant's business identity (name, address, phone).
 *
 * Admin + `config.manage` only; `enabled` keeps the hook order stable for
 * callers that render the section conditionally.
 */
export function useBusinessProfile(enabled = true) {
  return useQuery({
    queryKey: queryKeys.setup.profile(),
    queryFn: () => setupApi.getProfile(),
    enabled,
  });
}
