import { useQueryClient } from '@tanstack/react-query';
import { routesApi } from '../../api/routes.ts';
import { invalidateDomains } from '../invalidation.ts';
import { useOfflineAwareMutation } from '../use-offline-mutation.ts';

const ROUTE_DOMAINS = ['routes', 'orders'] as const;

export function useCreateRoute() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (data: Parameters<typeof routesApi.create>[0]) => routesApi.create(data),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useAddStop() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ routeId, orderId }: { routeId: string; orderId: string }) =>
      routesApi.addStop(routeId, orderId),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useRemoveStop() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ routeId, stopId }: { routeId: string; stopId: string }) =>
      routesApi.removeStop(routeId, stopId),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useReorderStops() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ routeId, stopOrder }: { routeId: string; stopOrder: string[] }) =>
      routesApi.reorderStops(routeId, stopOrder),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useOptimizeRoute() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ routeId, start }: { routeId: string; start?: { lat: number; lng: number } }) =>
      routesApi.optimize(routeId, start),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useStartRoute() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (routeId: string) => routesApi.startRoute(routeId),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useCompleteRoute() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ routeId, kmTravelled }: { routeId: string; kmTravelled?: number }) =>
      routesApi.completeRoute(routeId, kmTravelled),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useCancelRoute() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: (routeId: string) => routesApi.cancelRoute(routeId),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useAdvanceStop() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({
      routeId,
      stopId,
      status,
      notes,
    }: {
      routeId: string;
      stopId: string;
      status: string;
      notes?: string;
    }) => routesApi.advanceStop(routeId, stopId, status, notes),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}

export function useAddStopNote() {
  const queryClient = useQueryClient();
  return useOfflineAwareMutation({
    mutationFn: ({ routeId, stopId, notes }: { routeId: string; stopId: string; notes: string }) =>
      routesApi.addStopNote(routeId, stopId, notes),
    onSuccess: () => invalidateDomains(queryClient, ROUTE_DOMAINS),
  });
}
