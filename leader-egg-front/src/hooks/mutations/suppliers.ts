import { useQueryClient } from '@tanstack/react-query';
import {
  suppliersApi,
  type CreateSupplierPayload,
  type UpdateSupplierPayload,
} from '../../api/suppliers.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const SUPPLIER_DOMAINS = ['suppliers'] as const;

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateSupplierPayload) => suppliersApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, SUPPLIER_DOMAINS),
  });
}

export function useUpdateSupplier() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSupplierPayload }) =>
      suppliersApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, SUPPLIER_DOMAINS),
  });
}

export function useUpdateSupplierStatus() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      suppliersApi.updateStatus(id, active),
    onSuccess: () => invalidateDomains(queryClient, SUPPLIER_DOMAINS),
  });
}

export function useDeleteSupplier() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => suppliersApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, SUPPLIER_DOMAINS),
  });
}
