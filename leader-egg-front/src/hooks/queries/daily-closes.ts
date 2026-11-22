import { useQuery } from '@tanstack/react-query';
import { dailyClosesApi } from '../../api/daily-closes.ts';
import type { DailyCloseChannel } from '../../types/index.ts';
import { queryKeys } from '../query-keys.ts';

/** Day's computed numbers without persisting (date defaults to today). */
export function useDailyClosePreview(date?: string, channel?: DailyCloseChannel) {
  return useQuery({
    queryKey: queryKeys.dailyCloses.preview(date, channel),
    queryFn: () => dailyClosesApi.preview(date, channel),
  });
}

/** The close for a local day + channel — 404 when none exists. */
export function useDailyCloseByDate(date: string | undefined, channel?: DailyCloseChannel) {
  return useQuery({
    queryKey: queryKeys.dailyCloses.byDate(date ?? '', channel),
    queryFn: () => dailyClosesApi.getByDate(date as string, channel),
    enabled: Boolean(date),
  });
}

export function useDailyCloses(from?: string, to?: string, channel?: DailyCloseChannel) {
  return useQuery({
    queryKey: queryKeys.dailyCloses.list(from, to, channel),
    queryFn: () => dailyClosesApi.list(from, to, channel),
  });
}
