import { api } from './client.ts';
import type { Expense, CreateExpensePayload, ExpenseTotals } from '../types/index.ts';

export const expensesApi = {
  list(params?: {
    startDate?: string;
    endDate?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{ expenses: Expense[]; total: number; page: number; limit: number }> {
    const query: Record<string, string> = {};
    if (params?.startDate) query.startDate = params.startDate;
    if (params?.endDate) query.endDate = params.endDate;
    if (params?.category) query.category = params.category;
    if (params?.page) query.page = String(params.page);
    if (params?.limit) query.limit = String(params.limit);
    return api.get<{ expenses: Expense[]; total: number; page: number; limit: number }>('/v1/expenses', query);
  },

  create(data: CreateExpensePayload): Promise<Expense> {
    return api.post<Expense>('/v1/expenses', data);
  },

  getTotals(params?: { period?: 'monthly' | 'weekly'; date?: string }): Promise<ExpenseTotals> {
    const query: Record<string, string> = {};
    if (params?.period) query.period = params.period;
    if (params?.date) query.date = params.date;
    return api.get<ExpenseTotals>('/v1/expenses/totals', query);
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/expenses/${id}`);
  }
};
