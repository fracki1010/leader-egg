import { useQuery } from '@tanstack/react-query';
import { routesApi } from '../../api/routes.ts';
import { queryKeys } from '../query-keys.ts';

export function useRoutes(params?: Record<string, string>) {
  return useQuery({
    queryKey: queryKeys.routes.list(params),
    queryFn: () => routesApi.list(params),
  });
}

export function useDriverActiveRoute() {
  return useQuery({
    queryKey: queryKeys.routes.driverActive(),
    queryFn: () => routesApi.getDriverActive(),
  });
}

export function useRoute(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.routes.detail(id ?? ''),
    queryFn: () => routesApi.getById(id as string),
    enabled: Boolean(id),
  });
}
