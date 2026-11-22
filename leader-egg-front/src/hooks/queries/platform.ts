import { useQuery } from '@tanstack/react-query';
import { platformApi } from '../../api/platform.ts';
import { queryKeys } from '../query-keys.ts';

/** Every registered company (platform admin only). */
export function usePlatformTenants() {
  return useQuery({
    queryKey: queryKeys.platform.tenants(),
    queryFn: () => platformApi.listTenants(),
  });
}

/**
 * A tenant's punto-cero state read through the platform (super-admin) API.
 * Disabled until a tenant id is available so route params can resolve first.
 */
export function usePlatformPuntoCero(tenantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.platform.puntoCero(tenantId ?? ''),
    queryFn: () => {
      if (!tenantId) throw new Error('Falta el identificador de la empresa');
      return platformApi.getPuntoCero(tenantId);
    },
    enabled: Boolean(tenantId),
  });
}

export interface PlatformUserFilters {
  /** Restrict to a single company (tenant id). */
  tenantId?: string;
  /** Server-side, case-insensitive name/email search. */
  search?: string;
}

/**
 * Platform-wide user list. When `search` is set it uses the dedicated search
 * endpoint (across all tenants) and narrows to `tenantId` client-side; otherwise
 * it lists either every user or the selected company's users.
 */
export function usePlatformUsers(filters: PlatformUserFilters = {}) {
  const { tenantId, search } = filters;
  return useQuery({
    queryKey: queryKeys.platform.usersList(filters),
    queryFn: async () => {
      if (search) {
        const users = await platformApi.searchUsers(search);
        return tenantId ? users.filter((u) => u.tenantId === tenantId) : users;
      }
      return platformApi.listUsers(tenantId);
    },
  });
}
