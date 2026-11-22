import { useQuery } from '@tanstack/react-query';
import { purchasesApi, type PurchaseListFilters } from '../../api/purchases.ts';
import { queryKeys } from '../query-keys.ts';

export function usePurchases(filters: PurchaseListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.purchases.list(filters),
    queryFn: () => purchasesApi.list(filters),
  });
}

export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.purchases.detail(id ?? ''),
    queryFn: () => purchasesApi.get(id as string),
    enabled: Boolean(id),
  });
}
