import { api } from './client.ts';
import type { Route } from '../types/index.ts';

export const routesApi = {
  list(params?: Record<string, string>): Promise<Route[]> {
    return api.get<Route[]>('/v1/routes', params);
  },

  getDriverActive(): Promise<Route> {
    return api.get<Route>('/v1/routes/driver/active');
  },

  getById(id: string): Promise<Route> {
    return api.get<Route>(`/v1/routes/${id}`);
  },

  create(data: { driverId: string; plannedDate: string; vehicleId?: string }): Promise<Route> {
    return api.post<Route>('/v1/routes', data);
  },

  addStop(routeId: string, orderId: string): Promise<Route> {
    return api.post<Route>(`/v1/routes/${routeId}/stops`, { orderId });
  },

  removeStop(routeId: string, stopId: string): Promise<Route> {
    return api.delete<Route>(`/v1/routes/${routeId}/stops/${stopId}`);
  },

  reorderStops(routeId: string, stopOrder: string[]): Promise<Route> {
    return api.patch<Route>(`/v1/routes/${routeId}/stops/reorder`, { stopOrder });
  },

  optimize(routeId: string, start?: { lat: number; lng: number }): Promise<Route> {
    return api.post<Route>(`/v1/routes/${routeId}/optimize`, start ? { start } : {});
  },

  startRoute(routeId: string): Promise<Route> {
    return api.patch<Route>(`/v1/routes/${routeId}/start`);
  },

  /** Complete a route. `kmTravelled` is optional (≥ 0) and persists only when provided. */
  completeRoute(routeId: string, kmTravelled?: number): Promise<Route> {
    const body = kmTravelled !== undefined ? { kmTravelled } : undefined;
    return api.patch<Route>(`/v1/routes/${routeId}/complete`, body);
  },

  cancelRoute(routeId: string): Promise<Route> {
    return api.patch<Route>(`/v1/routes/${routeId}/cancel`);
  },

  advanceStop(routeId: string, stopId: string, status: string, notes?: string): Promise<Route> {
    return api.patch<Route>(`/v1/routes/${routeId}/stops/${stopId}/advance`, { status, notes });
  },

  addStopNote(routeId: string, stopId: string, notes: string): Promise<Route> {
    return api.patch<Route>(`/v1/routes/${routeId}/stops/${stopId}/notes`, { notes });
  },
};
