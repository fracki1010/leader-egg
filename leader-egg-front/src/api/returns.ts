import { api } from './client.ts';
import type { OrderReturn, ReturnEffect, ReturnReason } from '../types/index.ts';

export interface CreateReturnPayload {
  items: { productId: string; quantity: number }[];
  reason: ReturnReason;
  effect: ReturnEffect;
  /** Optional partial refund — defaults to the paid portion of the effective
   *  returned value (backend caps it there and at what was actually paid). */
  refundAmount?: number;
  notes?: string;
}

export interface ReturnListFilters {
  customerId?: string;
  from?: string;
  to?: string;
  reason?: ReturnReason;
  limit?: number;
  page?: number;
}

export interface ReturnListResult {
  items: OrderReturn[];
  total: number;
  page: number;
  limit: number;
}

export const returnsApi = {
  /** POST /v1/orders/:id/returns — admin and driver. */
  create(orderId: string, payload: CreateReturnPayload): Promise<OrderReturn> {
    return api.post<OrderReturn>(`/v1/orders/${orderId}/returns`, payload);
  },

  /** GET /v1/orders/:id/returns — newest first. */
  listForOrder(orderId: string): Promise<OrderReturn[]> {
    return api.get<OrderReturn[]>(`/v1/orders/${orderId}/returns`);
  },

  /** GET /v1/returns — admin only, with customerId/from/to/reason filters. */
  list(filters: ReturnListFilters = {}): Promise<ReturnListResult> {
    const params: Record<string, string> = {};
    if (filters.customerId) params.customerId = filters.customerId;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.reason) params.reason = filters.reason;
    if (filters.limit !== undefined) params.limit = String(filters.limit);
    if (filters.page !== undefined) params.page = String(filters.page);
    return api.get<ReturnListResult>('/v1/returns', params);
  },
};