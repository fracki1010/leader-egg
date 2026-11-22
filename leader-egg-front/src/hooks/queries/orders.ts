import { useQuery } from '@tanstack/react-query';
import { ordersApi, type OrderListFilters } from '../../api/orders.ts';
import { queryKeys } from '../query-keys.ts';

export function useOrders(filters?: OrderListFilters) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: () => ordersApi.list(filters),
  });
}

export function useOverdueOrders() {
  return useQuery({
    queryKey: queryKeys.orders.overdue(),
    queryFn: () => ordersApi.listOverdue(),
  });
}

export function useTodayOrders() {
  return useQuery({
    queryKey: queryKeys.orders.today(),
    queryFn: () => ordersApi.getToday(),
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id ?? ''),
    queryFn: () => ordersApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCustomerOutstanding(customerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orders.outstanding(customerId ?? ''),
    queryFn: () => ordersApi.getCustomerOutstanding(customerId as string),
    enabled: Boolean(customerId),
  });
}
