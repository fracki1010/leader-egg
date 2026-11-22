import { useQueryClient } from '@tanstack/react-query';
import {
  productsApi,
  type CreatePricePayload,
  type CreateProductPayload,
  type UpdateProductPayload,
} from '../../api/products.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const PRODUCT_DOMAINS = ['products', 'inventory', 'dashboard'] as const;

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateProductPayload) => productsApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, PRODUCT_DOMAINS),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductPayload }) =>
      productsApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, PRODUCT_DOMAINS),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, PRODUCT_DOMAINS),
  });
}

export function useCreatePrice() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ productId, data }: { productId: string; data: CreatePricePayload }) =>
      productsApi.createPrice(productId, data),
    onSuccess: () => invalidateDomains(queryClient, ['products']),
  });
}
