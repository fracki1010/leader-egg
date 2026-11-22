import { useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/users.ts';
import { authApi } from '../../api/auth.ts';
import type { RegisterRequest, UpdateUserRequest } from '../../types/index.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

// User role/assignment changes affect route planning selects.
const USER_DOMAINS = ['users', 'routes'] as const;

export function useRegisterUser() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (data: RegisterRequest) => authApi.register(data),
    onSuccess: () => invalidateDomains(queryClient, USER_DOMAINS),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserRequest }) =>
      usersApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, USER_DOMAINS),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => invalidateDomains(queryClient, USER_DOMAINS),
  });
}
