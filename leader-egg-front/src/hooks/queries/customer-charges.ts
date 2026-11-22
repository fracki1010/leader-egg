import { useQuery } from '@tanstack/react-query';
import { customerChargesApi } from '../../api/customer-charges.ts';
import { queryKeys } from '../query-keys.ts';

/** Newest-first manual charge history for one customer. */
export function useCustomerCharges(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customerCharges.list(customerId ?? ''),
    queryFn: () => customerChargesApi.list(customerId as string),
    enabled: Boolean(customerId),
  });
}
