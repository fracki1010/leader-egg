import { useQuery } from '@tanstack/react-query';
import { expensesApi } from '../../api/expenses.ts';
import { queryKeys } from '../query-keys.ts';

type ExpenseListParams = {
  startDate?: string;
  endDate?: string;
  category?: string;
  page?: number;
  limit?: number;
};

export function useExpenses(params?: ExpenseListParams) {
  return useQuery({
    queryKey: queryKeys.expenses.list(params),
    queryFn: () => expensesApi.list(params),
  });
}

export function useExpenseTotals(params?: { period?: 'monthly' | 'weekly'; date?: string }) {
  return useQuery({
    queryKey: queryKeys.expenses.totals(params),
    queryFn: () => expensesApi.getTotals(params),
  });
}
