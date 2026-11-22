import { useQueryClient } from '@tanstack/react-query';
import { expensesApi } from '../../api/expenses.ts';
import type { CreateExpensePayload } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const EXPENSE_DOMAINS = ['expenses', 'dashboard', 'cash'] as const;

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateExpensePayload) => expensesApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, EXPENSE_DOMAINS),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, EXPENSE_DOMAINS),
  });
}
