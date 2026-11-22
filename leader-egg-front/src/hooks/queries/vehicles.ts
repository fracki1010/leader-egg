import { useQuery } from '@tanstack/react-query';
import { vehiclesApi } from '../../api/vehicles.ts';
import { queryKeys } from '../query-keys.ts';

export function useVehicles(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.vehicles.list(includeInactive),
    queryFn: () => vehiclesApi.list(includeInactive),
  });
}

/** Aggregated vehicle detail (costs, stats, recent routes). */
export function useVehicle(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.vehicles.detail(id ?? ''),
    queryFn: () => vehiclesApi.getDetail(id as string),
    enabled: Boolean(id),
  });
}
