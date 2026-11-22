import { api } from './client.ts';
import type {
  CashAdjustment,
  CashAdjustmentsResponse,
  CreateCashAdjustmentRequest,
} from '../types/index.ts';

export const cashAdjustmentsApi = {
  list(params?: {
    from?: string;
    to?: string;
    account?: string;
    createdBy?: string;
    page?: number;
    limit?: number;
  }): Promise<CashAdjustmentsResponse> {
    const query: Record<string, string> = {};
    if (params?.from) query.from = params.from;
    if (params?.to) query.to = params.to;
    if (params?.account) query.account = params.account;
    if (params?.createdBy) query.createdBy = params.createdBy;
    if (params?.page) query.page = String(params.page);
    if (params?.limit) query.limit = String(params.limit);
    return api.get<CashAdjustmentsResponse>('/v1/cash-adjustments', query);
  },

  create(data: CreateCashAdjustmentRequest): Promise<CashAdjustment> {
    return api.post<CashAdjustment>('/v1/cash-adjustments', data);
  },
};
