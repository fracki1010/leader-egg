import { useQuery } from '@tanstack/react-query';
import { inventoryApi, type TransactionFilters } from '../../api/inventory.ts';
import { queryKeys } from '../query-keys.ts';

export function useInventory() {
  return useQuery({
    queryKey: queryKeys.inventory.list(),
    queryFn: () => inventoryApi.getAll(),
  });
}

export function useInventoryByProduct(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventory.detail(productId ?? ''),
    queryFn: () => inventoryApi.getByProduct(productId as string),
    enabled: Boolean(productId),
  });
}

export function useInventoryTransactions(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventory.transactions(productId ?? ''),
    queryFn: () => inventoryApi.getTransactions(productId as string),
    enabled: Boolean(productId),
  });
}

export function useInventoryTransactionsList(filters: TransactionFilters = {}) {
  return useQuery({
    queryKey: queryKeys.inventory.transactionsList(filters),
    queryFn: () => inventoryApi.listTransactions(filters),
  });
}
