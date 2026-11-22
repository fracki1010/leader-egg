import { useQuery } from '@tanstack/react-query';
import {
  promotionsApi,
  type ActivePromotionFilters,
  type PromotionListFilters,
} from '../../api/promotions.ts';
import { queryKeys } from '../query-keys.ts';

export function usePromotions(filters?: PromotionListFilters) {
  return useQuery({
    queryKey: queryKeys.promotions.list(filters),
    queryFn: () => promotionsApi.list(filters),
  });
}

export function useActivePromotions(filters?: ActivePromotionFilters) {
  return useQuery({
    queryKey: queryKeys.promotions.active(filters),
    queryFn: () => promotionsApi.listActive(filters),
  });
}

export function usePromotion(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.promotions.detail(id ?? ''),
    queryFn: () => promotionsApi.get(id as string),
    enabled: Boolean(id),
  });
}
