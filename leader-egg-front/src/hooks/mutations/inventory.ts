import { useQueryClient } from '@tanstack/react-query';
import {
  inventoryApi,
  type AdjustStockPayload,
  type ClassifyPayload,
  type CreateInventoryPayload,
} from '../../api/inventory.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const INVENTORY_DOMAINS = ['inventory', 'products', 'dashboard'] as const;

export function useCreateInventory() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateInventoryPayload) => inventoryApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}

export function useDeleteInventory() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (productId: string) => inventoryApi.remove(productId),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ productId, data }: { productId: string; data: AdjustStockPayload }) =>
      inventoryApi.adjustStock(productId, data),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}

export function useIncrementStock() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ productId, data }: { productId: string; data: AdjustStockPayload }) =>
      inventoryApi.incrementStock(productId, data),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}

export function useDecrementStock() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ productId, data }: { productId: string; data: AdjustStockPayload }) =>
      inventoryApi.decrementStock(productId, data),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}

export function useClassifyInventory() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ fromProductId, data }: { fromProductId: string; data: ClassifyPayload }) =>
      inventoryApi.classify(fromProductId, data),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}

export function useUpdateThreshold() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({
      productId,
      lowStockThreshold,
    }: {
      productId: string;
      lowStockThreshold: number;
    }) => inventoryApi.updateThreshold(productId, lowStockThreshold),
    onSuccess: () => invalidateDomains(queryClient, INVENTORY_DOMAINS),
  });
}
