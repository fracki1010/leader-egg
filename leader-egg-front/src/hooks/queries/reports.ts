import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports.ts';
import { queryKeys } from '../query-keys.ts';

export function useAgingReport(customerId?: string) {
  return useQuery({
    queryKey: queryKeys.reports.aging(customerId),
    queryFn: () => reportsApi.getAgingReport(customerId),
  });
}

export function useRevenueReport(startDate: string | undefined, endDate: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reports.revenue(startDate ?? '', endDate ?? ''),
    queryFn: () => reportsApi.getRevenueReport(startDate as string, endDate as string),
    enabled: Boolean(startDate && endDate),
  });
}

export function useProfitReport(startDate: string | undefined, endDate: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reports.profit(startDate ?? '', endDate ?? ''),
    queryFn: () => reportsApi.getProfitReport(startDate as string, endDate as string),
    enabled: Boolean(startDate && endDate),
  });
}

export function useCustomerHistory(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reports.customerHistory(customerId ?? ''),
    queryFn: () => reportsApi.getCustomerHistory(customerId as string),
    enabled: Boolean(customerId),
  });
}

export function useCustomerFrequency(
  customerId: string | undefined,
  period: 'weekly' | 'monthly' = 'monthly',
  startDate?: string,
  endDate?: string,
) {
  return useQuery({
    queryKey: queryKeys.reports.customerFrequency(customerId ?? '', period, startDate, endDate),
    queryFn: () =>
      reportsApi.getCustomerFrequency(customerId as string, period, startDate, endDate),
    enabled: Boolean(customerId),
  });
}

export function useTopCustomers(limit = 10) {
  return useQuery({
    queryKey: queryKeys.reports.topCustomers(limit),
    queryFn: () => reportsApi.getTopCustomers(limit),
  });
}
