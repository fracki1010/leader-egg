import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../../api/users.ts';
import { queryKeys } from '../query-keys.ts';

/** Driver-role users (for route/vehicle assignment selects). */
export function useDrivers() {
  return useQuery({
    queryKey: queryKeys.users.drivers(),
    queryFn: () => usersApi.listDrivers(),
  });
}

/** Every user (admin only). */
export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: () => usersApi.list(),
  });
}
