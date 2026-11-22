import { useQueryClient } from '@tanstack/react-query';
import {
  purchasesApi,
  type CreatePurchasePayload,
  type RecordPaymentPayload,
  type UpdatePurchasePayload,
} from '../../api/purchases.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const PURCHASE_DOMAINS = [
  'purchases',
  'inventory',
  'suppliers',
  'dashboard',
  'accounts',
] as const;

export function useCreatePurchase() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreatePurchasePayload) => purchasesApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, PURCHASE_DOMAINS),
  });
}

export function useUpdatePurchase() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePurchasePayload }) =>
      purchasesApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, PURCHASE_DOMAINS),
  });
}

export function useDeliverPurchase() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => purchasesApi.deliver(id),
    onSuccess: () => invalidateDomains(queryClient, PURCHASE_DOMAINS),
  });
}

export function useCancelPurchase() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => purchasesApi.cancel(id),
    onSuccess: () => invalidateDomains(queryClient, PURCHASE_DOMAINS),
  });
}

export function useRecordPurchasePayment() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: RecordPaymentPayload }) =>
      purchasesApi.recordPayment(id, data),
    onSuccess: () => invalidateDomains(queryClient, PURCHASE_DOMAINS),
  });
}

export function useDeletePurchase() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => purchasesApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, PURCHASE_DOMAINS),
  });
}
