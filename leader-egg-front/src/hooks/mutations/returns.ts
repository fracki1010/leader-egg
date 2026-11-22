import { useQueryClient } from '@tanstack/react-query';
import { returnsApi, type CreateReturnPayload } from '../../api/returns.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

// A return can restock inventory and adjust order/account balances.
const RETURN_DOMAINS = ['returns', 'orders', 'inventory', 'accounts', 'dashboard'] as const;

export function useCreateReturn() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: CreateReturnPayload }) =>
      returnsApi.create(orderId, data),
    onSuccess: () => invalidateDomains(queryClient, RETURN_DOMAINS),
  });
}
