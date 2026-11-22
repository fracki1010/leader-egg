import { useQueryClient } from '@tanstack/react-query';
import { cashAdjustmentsApi } from '../../api/cash-adjustments.ts';
import type { CreateCashAdjustmentRequest } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const CASH_ADJUSTMENT_DOMAINS = ['cashAdjustments', 'dashboard', 'cash'] as const;

export function useCreateCashAdjustment() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateCashAdjustmentRequest) => cashAdjustmentsApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, CASH_ADJUSTMENT_DOMAINS),
  });
}
