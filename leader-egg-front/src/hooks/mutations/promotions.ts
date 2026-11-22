import { useQueryClient } from '@tanstack/react-query';
import {
  promotionsApi,
  type CreatePromotionPayload,
  type UpdatePromotionPayload,
} from '../../api/promotions.ts';
import type { PromotionStatus } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const PROMOTION_DOMAINS = ['promotions'] as const;

export function useCreatePromotion() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreatePromotionPayload) => promotionsApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, PROMOTION_DOMAINS),
  });
}

export function useUpdatePromotion() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePromotionPayload }) =>
      promotionsApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, PROMOTION_DOMAINS),
  });
}

export function useSetPromotionStatus() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, status }: { id: string; status: PromotionStatus }) =>
      promotionsApi.setStatus(id, status),
    onSuccess: () => invalidateDomains(queryClient, PROMOTION_DOMAINS),
  });
}

export function useDeletePromotion() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => promotionsApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, PROMOTION_DOMAINS),
  });
}
