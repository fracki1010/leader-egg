import { api } from './client.ts';
import type { CashMovementsResponse, CashSummary, CashMovementType, MoneyAccount } from '../types/index.ts';

/** Filters accepted by the unified cash ledger endpoint. */
export interface CashMovementListParams {
  from?: string;
  to?: string;
  account?: MoneyAccount;
  type?: CashMovementType;
  page?: number;
  limit?: number;
}

/**
 * Unified cash ledger — every money account movement (payments, expenses,
 * adjustments, purchase payments and refunds) in a single signed feed.
 */
export const cashApi = {
  listMovements(params?: CashMovementListParams): Promise<CashMovementsResponse> {
    const query: Record<string, string> = {};
    if (params?.from) query.from = params.from;
    if (params?.to) query.to = params.to;
    if (params?.account) query.account = params.account;
    if (params?.type) query.type = params.type;
    if (params?.page) query.page = String(params.page);
    if (params?.limit) query.limit = String(params.limit);
    return api.get<CashMovementsResponse>('/v1/cash/movements', query);
  },

  /** Per-account balances + today's in/out/net totals. */
  getSummary(): Promise<CashSummary> {
    return api.get<CashSummary>('/v1/cash/summary');
  },
};
