import { useQuery } from '@tanstack/react-query';
import { accountsApi, type AccountsFilters } from '../../api/accounts.ts';
import { queryKeys } from '../query-keys.ts';

export function useAccounts(filters: AccountsFilters = {}) {
  return useQuery({
    queryKey: queryKeys.accounts.list(filters),
    queryFn: () => accountsApi.list(filters),
  });
}

export function useAccountMovements(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.accounts.movements(customerId ?? ''),
    queryFn: () => accountsApi.getMovements(customerId as string),
    enabled: Boolean(customerId),
  });
}
