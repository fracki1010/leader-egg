import { useQueryClient } from '@tanstack/react-query';
import {
  customersApi,
  type CreateCustomerPayload,
  type UpdateCustomerPayload,
} from '../../api/customers.ts';
import type { CustomerStatus } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const CUSTOMER_DOMAINS = ['customers', 'dashboard', 'accounts'] as const;

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateCustomerPayload) => customersApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, CUSTOMER_DOMAINS),
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCustomerPayload }) =>
      customersApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, CUSTOMER_DOMAINS),
  });
}

export function useUpdateCustomerStatus() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, status }: { id: string; status: CustomerStatus }) =>
      customersApi.updateStatus(id, status),
    onSuccess: () => invalidateDomains(queryClient, CUSTOMER_DOMAINS),
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => customersApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, CUSTOMER_DOMAINS),
  });
}
