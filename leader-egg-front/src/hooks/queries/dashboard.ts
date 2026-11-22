import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../api/dashboard.ts';
import { DASHBOARD_STALE_TIME_MS } from '../../lib/query-client.ts';
import { queryKeys } from '../query-keys.ts';

/** Consolidated dashboard numbers — refreshed more aggressively than default. */
export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: () => dashboardApi.getSummary(),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useDashboardAlerts() {
  return useQuery({
    queryKey: queryKeys.dashboard.alerts(),
    queryFn: () => dashboardApi.getAlerts(),
  });
}
