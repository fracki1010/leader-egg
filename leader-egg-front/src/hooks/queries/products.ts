import { useQuery } from '@tanstack/react-query';
import { productsApi, type ProductListFilters } from '../../api/products.ts';
import type { PriceUnit } from '../../types/index.ts';
import { queryKeys } from '../query-keys.ts';

export function useProducts(filters?: ProductListFilters) {
  return useQuery({
    queryKey: queryKeys.products.list(filters),
    queryFn: () => productsApi.list(filters),
  });
}

export function useProductOptions() {
  return useQuery({
    queryKey: queryKeys.products.options(),
    queryFn: () => productsApi.getOptions(),
    staleTime: Infinity,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.detail(id ?? ''),
    queryFn: () => productsApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useProductPrices(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.prices(productId ?? ''),
    queryFn: () => productsApi.listPrices(productId as string),
    enabled: Boolean(productId),
  });
}

export function useActivePrice(
  productId: string | undefined,
  unit?: PriceUnit,
  date?: string,
) {
  return useQuery({
    queryKey: queryKeys.products.activePrice(productId ?? '', unit, date),
    queryFn: () => productsApi.getActivePrice(productId as string, unit, date),
    enabled: Boolean(productId),
  });
}
