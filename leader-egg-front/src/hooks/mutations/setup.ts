import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  setupApi,
  type UpdateBusinessProfilePayload,
  type UpdateOpeningBalancesPayload,
} from '../../api/setup.ts';
import type { SetupPuntoCeroPayload } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { queryKeys } from '../query-keys.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

// Punto-cero finalization seeds opening balances, stock and debts across domains.
const SETUP_DOMAINS = [
  'setup',
  'dashboard',
  'inventory',
  'customers',
  'suppliers',
] as const;

export function useSetPuntoCero() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: SetupPuntoCeroPayload) => setupApi.setPuntoCero(payload),
    onSuccess: () => invalidateDomains(queryClient, SETUP_DOMAINS),
  });
}

/**
 * Correct the initial opening balances ("Cuentas de la Empresa").
 *
 * Changing the opening balances shifts the current `/cash/summary` balances
 * directly, so both the `cash` domain and the `setup` (punto-cero) query are
 * invalidated on success.
 */
export function useUpdateOpeningBalances() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: UpdateOpeningBalancesPayload) => setupApi.updateOpeningBalances(payload),
    onSuccess: () => invalidateDomains(queryClient, ['setup', 'cash']),
  });
}

/**
 * Update the tenant's business identity (name, address, phone).
 *
 * The PATCH returns the refreshed profile, which is written straight into the
 * cache so the form and any other reader stay in sync without a refetch.
 */
export function useUpdateBusinessProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateBusinessProfilePayload) => setupApi.updateProfile(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.setup.profile(), data);
    },
  });
}
