import { useQueryClient } from '@tanstack/react-query';
import {
  vehiclesApi,
  type CreateVehiclePayload,
  type UpdateVehiclePayload,
} from '../../api/vehicles.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

// Vehicle assignment affects route planning, so routes are invalidated too.
const VEHICLE_ASSIGNMENT_DOMAINS = ['vehicles', 'routes'] as const;
const VEHICLE_DOMAINS = ['vehicles'] as const;

export function useCreateVehicle() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (payload: CreateVehiclePayload) => vehiclesApi.create(payload),
    onSuccess: () => invalidateDomains(queryClient, VEHICLE_ASSIGNMENT_DOMAINS),
  });
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVehiclePayload }) =>
      vehiclesApi.update(id, data),
    onSuccess: () => invalidateDomains(queryClient, VEHICLE_ASSIGNMENT_DOMAINS),
  });
}

export function useSetVehicleStatus() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      vehiclesApi.setStatus(id, active),
    onSuccess: () => invalidateDomains(queryClient, VEHICLE_DOMAINS),
  });
}
