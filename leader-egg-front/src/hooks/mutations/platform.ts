import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '../../api/platform.ts';
import { queryKeys } from '../query-keys.ts';
import type {
  ChangePasswordRequest,
  CreatePlatformUserRequest,
  CreateTenantRequest,
  SetPlatformPuntoCeroPayload,
  UpdatePlatformUserRequest,
  UpdateTenantRequest,
} from '../../types/index.ts';

/** Invalidate the tenant list after any platform write. */
function useInvalidateTenants() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenants() });
}

/** Invalidate every platform user list after a user write. */
function useInvalidatePlatformUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.platform.users() });
}

export function useCreateTenant() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: (data: CreateTenantRequest) => platformApi.createTenant(data),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTenant() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTenantRequest }) =>
      platformApi.updateTenant(id, data),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteTenant() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({ id, slug }: { id: string; slug: string }) =>
      platformApi.deleteTenant(id, slug),
    onSuccess: () => invalidate(),
  });
}

/**
 * Clear a tenant's business data from the platform panel.
 *
 * Invalidates the tenant list (user counts stay, but the summary may change) and
 * the tenant's punto-cero query, which is reset to pending by the backend.
 */
export function useResetPlatformTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tenantId,
      payload,
    }: {
      tenantId: string;
      payload: { confirm: string; zeroCustomerDebt?: boolean };
    }) => platformApi.resetTenant(tenantId, payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenants() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.platform.puntoCero(variables.tenantId),
      });
    },
  });
}

/**
 * Run a tenant's punto cero from the platform panel.
 *
 * The tenant list is invalidated on success (the company summary may change)
 * and the refreshed payload is written into the tenant's punto-cero cache.
 */
export function useSetPlatformPuntoCero() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tenantId,
      payload,
    }: {
      tenantId: string;
      payload: SetPlatformPuntoCeroPayload;
    }) => platformApi.setPuntoCero(tenantId, payload),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        queryKeys.platform.puntoCero(variables.tenantId),
        data,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenants() });
    },
  });
}

/** Changes the signed-in platform admin's password. No cache to invalidate. */
export function useChangePlatformPassword() {
  return useMutation({
    mutationFn: (data: ChangePasswordRequest) => platformApi.changePassword(data),
  });
}

// ── Platform-wide user management ────────────────────────────────────────────

export function useCreatePlatformUser() {
  const invalidate = useInvalidatePlatformUsers();
  return useMutation({
    mutationFn: (data: CreatePlatformUserRequest) => platformApi.createUser(data),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePlatformUser() {
  const invalidate = useInvalidatePlatformUsers();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePlatformUserRequest }) =>
      platformApi.updateUser(id, data),
    onSuccess: () => invalidate(),
  });
}

export function useDeletePlatformUser() {
  const invalidate = useInvalidatePlatformUsers();
  return useMutation({
    mutationFn: ({ id, tenantId }: { id: string; tenantId: string }) =>
      platformApi.deleteUser(id, tenantId),
    onSuccess: () => invalidate(),
  });
}

export function useResetPlatformUserPassword() {
  const invalidate = useInvalidatePlatformUsers();
  return useMutation({
    mutationFn: ({
      id,
      tenantId,
      newPassword,
    }: {
      id: string;
      tenantId: string;
      newPassword: string;
    }) => platformApi.resetUserPassword(id, tenantId, newPassword),
    onSuccess: () => invalidate(),
  });
}
