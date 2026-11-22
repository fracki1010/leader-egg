import { useQuery } from '@tanstack/react-query';
import { paymentsApi } from '../../api/payments.ts';
import { queryKeys } from '../query-keys.ts';

export function usePayments(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payments.list(orderId ?? ''),
    queryFn: () => paymentsApi.list(orderId as string),
    enabled: Boolean(orderId),
  });
}

export function useReceipt(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payments.receipt(orderId ?? ''),
    queryFn: () => paymentsApi.getReceipt(orderId as string),
    enabled: Boolean(orderId),
  });
}
