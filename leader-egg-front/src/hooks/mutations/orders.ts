import { useQueryClient } from '@tanstack/react-query';
import {
  ordersApi,
  type CreateOrderPayload,
  type UpdateOrderPayload,
} from '../../api/orders.ts';
import type { CancelMoneyAction, OrderStatus } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const ORDER_DOMAINS = ['orders', 'dashboard', 'accounts', 'customers'] as const;

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateOrderPayload) => ordersApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, ORDER_DOMAINS),
  });
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrderPayload }) =>
      ordersApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, ORDER_DOMAINS),
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => ordersApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, ORDER_DOMAINS),
  });
}

export function useTransitionOrderStatus() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({
      id,
      status,
      moneyAction,
    }: {
      id: string;
      status: OrderStatus;
      moneyAction?: CancelMoneyAction;
    }) =>
      moneyAction !== undefined
        ? ordersApi.transitionStatus(id, status, moneyAction)
        : ordersApi.transitionStatus(id, status),
    onSuccess: () => invalidateDomains(queryClient, ORDER_DOMAINS),
  });
}
