import { useQuery } from '@tanstack/react-query';
import {
  customersApi,
  type CustomerListFilters,
  type CustomerOrdersFilters,
} from '../../api/customers.ts';
import { queryKeys } from '../query-keys.ts';

/** Legacy unfiltered customer list. */
export function useCustomers(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.customers.list({ includeInactive }),
    queryFn: () => customersApi.list(includeInactive),
  });
}

/** Filtered/paginated customer list (search, type, status). */
export function useCustomersFiltered(filters: CustomerListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.customers.list(filters),
    queryFn: () => customersApi.listFiltered(filters),
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customers.detail(id ?? ''),
    queryFn: () => customersApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCustomerSummary(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customers.summary(id ?? ''),
    queryFn: () => customersApi.getSummary(id as string),
    enabled: Boolean(id),
  });
}

export function useCustomerOrders(
  id: string | undefined,
  filters: CustomerOrdersFilters = {},
) {
  return useQuery({
    queryKey: queryKeys.customers.orders(id ?? '', filters),
    queryFn: () => customersApi.getOrders(id as string, filters),
    enabled: Boolean(id),
  });
}
