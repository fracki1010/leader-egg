import { api } from './client.ts';
import type { PriceUnit, Promotion, PromotionStatus, PromotionType } from '../types/index.ts';

export interface CreatePromotionPayload {
  name: string;
  productId: string;
  description?: string;
  type: PromotionType;
  /** fixed_price → promo unit price; discount_percent → % off; buy_x_get_y → buy X get Y total. */
  value: number;
  /** buy_x_get_y → total units per group ("pagás X llevás Y"); null/absent = legacy (value + 1). */
  getQuantity?: number | null;
  /** 'maple' (default) or 'cajon'. */
  unit?: PriceUnit;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  /** null = unlimited. */
  stockLimit?: number | null;
  /** null = no date limit. */
  expiresAt?: string | null;
  status?: PromotionStatus;
}

export interface UpdatePromotionPayload {
  name?: string;
  productId?: string;
  description?: string;
  type?: PromotionType;
  value?: number;
  getQuantity?: number | null;
  unit?: PriceUnit;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  stockLimit?: number | null;
  expiresAt?: string | null;
  status?: PromotionStatus;
}

/** Filters for GET /v1/promotions (admin management list). */
export interface PromotionListFilters {
  status?: PromotionStatus;
  productId?: string;
}

/** Filters for GET /v1/promotions/active (order-creation preview). */
export interface ActivePromotionFilters {
  productId?: string;
  unit?: PriceUnit;
}

export const promotionsApi = {
  /** Admin list — all promotions, optionally filtered by status/productId. */
  list(filters?: PromotionListFilters): Promise<Promotion[]> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.productId) params.productId = filters.productId;
    return api.get<Promotion[]>('/v1/promotions', params);
  },

  /** Currently eligible promos (active, not expired, stock available) — preview for order creation. */
  listActive(filters?: ActivePromotionFilters): Promise<Promotion[]> {
    const params: Record<string, string> = {};
    if (filters?.productId) params.productId = filters.productId;
    if (filters?.unit) params.unit = filters.unit;
    return api.get<Promotion[]>('/v1/promotions/active', params);
  },

  get(id: string): Promise<Promotion> {
    return api.get<Promotion>(`/v1/promotions/${id}`);
  },

  create(data: CreatePromotionPayload): Promise<Promotion> {
    return api.post<Promotion>('/v1/promotions', data);
  },

  update(id: string, data: UpdatePromotionPayload): Promise<Promotion> {
    return api.put<Promotion>(`/v1/promotions/${id}`, data);
  },

  /** Toggles the promotion status (active ↔ inactive). */
  setStatus(id: string, status: PromotionStatus): Promise<Promotion> {
    return api.patch<Promotion>(`/v1/promotions/${id}/status`, { status });
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/promotions/${id}`);
  }
};