import { api } from './client.ts';
import type {
  CreditConfig,
  CustomerStatus,
  CustomerType,
  Order,
  Payment,
} from '../types/index.ts';

/** One customer's consolidated account state (GET /v1/accounts). */
export interface AccountRow {
  customerId: string;
  customerName: string;
  type: CustomerType | null;
  outstandingBalance: number;
  openOrdersCount: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  hasPendingOrders: boolean;
  lastOrderDate: string | null;
  totalSpent: number;
  creditLimit: number;
  creditUsedPct: number;
  status: CustomerStatus;
}

export interface AccountsListResult {
  items: AccountRow[];
  total: number;
  page: number;
  limit: number;
}

export interface AccountMovement {
  type: 'order' | 'payment' | 'opening' | 'return' | 'charge' | 'credit';
  id: string;
  date: string;
  description: string;
  amount: number;
  sign: '+' | '-';
  method?: string;
  reference?: string | null;
}

export interface AccountSummary {
  outstandingBalance: number;
  openOrdersCount: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  totalSpent: number;
  lastOrderDate: string | null;
}

/** Account ledger for one customer (GET /v1/accounts/:customerId/movements). */
export interface AccountMovementsResult {
  customer: {
    _id: string;
    name: string;
    type: CustomerType;
    status: CustomerStatus;
    creditConfig: CreditConfig;
  };
  summary: AccountSummary;
  movements: AccountMovement[];
  orders: { items: Order[]; total: number; page: number; limit: number };
  payments: Payment[];
}

export type AccountSort = 'name' | 'balance' | 'overdue';

export interface AccountsFilters {
  onlyDebtors?: boolean;
  overdueOnly?: boolean;
  search?: string;
  status?: CustomerStatus;
  sort?: AccountSort;
  page?: number;
  limit?: number;
}

export const accountsApi = {
  /** Consolidated account list for all customers (superadmin only). */
  list(filters: AccountsFilters = {}): Promise<AccountsListResult> {
    const params: Record<string, string> = {};
    if (filters.onlyDebtors) params.onlyDebtors = 'true';
    if (filters.overdueOnly) params.overdueOnly = 'true';
    if (filters.search) params.search = filters.search;
    if (filters.status) params.status = filters.status;
    if (filters.sort) params.sort = filters.sort;
    if (filters.page !== undefined) params.page = String(filters.page);
    if (filters.limit !== undefined) params.limit = String(filters.limit);
    return api.get<AccountsListResult>('/v1/accounts', params);
  },

  /** Account ledger (movements + summary + open orders) for one customer. */
  getMovements(customerId: string): Promise<AccountMovementsResult> {
    return api.get<AccountMovementsResult>(`/v1/accounts/${customerId}/movements`);
  },
};