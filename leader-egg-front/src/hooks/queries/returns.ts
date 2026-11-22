import { useQuery } from '@tanstack/react-query';
import { returnsApi, type ReturnListFilters } from '../../api/returns.ts';
import { queryKeys } from '../query-keys.ts';

export function useOrderReturns(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.returns.order(orderId ?? ''),
    queryFn: () => returnsApi.listForOrder(orderId as string),
    enabled: Boolean(orderId),
  });
}

export function useReturns(filters: ReturnListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.returns.list(filters),
    queryFn: () => returnsApi.list(filters),
  });
}
