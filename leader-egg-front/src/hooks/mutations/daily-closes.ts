import { useQueryClient } from '@tanstack/react-query';
import { dailyClosesApi } from '../../api/daily-closes.ts';
import type { CreateDailyClosePayload, UpdateDailyClosePayload } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const DAILY_CLOSE_DOMAINS = ['dailyCloses', 'dashboard'] as const;

export function useCreateDailyClose() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateDailyClosePayload) => dailyClosesApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, DAILY_CLOSE_DOMAINS),
  });
}

export function useUpdateDailyClose() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDailyClosePayload }) =>
      dailyClosesApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, DAILY_CLOSE_DOMAINS),
  });
}
