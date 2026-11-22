import { useQuery } from '@tanstack/react-query';
import { suppliersApi } from '../../api/suppliers.ts';
import { queryKeys } from '../query-keys.ts';

export function useSuppliers(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.suppliers.list(includeInactive),
    queryFn: () => suppliersApi.list(includeInactive),
  });
}

export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.suppliers.detail(id ?? ''),
    queryFn: () => suppliersApi.get(id as string),
    enabled: Boolean(id),
  });
}
