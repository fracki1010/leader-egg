import { api } from './client.ts';
import type { FuelType, Vehicle, VehicleDetail } from '../types/index.ts';

export interface CreateVehiclePayload {
  name: string;
  model?: string;
  plate: string;
  fuelType?: FuelType;
  km?: number;
  consumptionKmPerL?: number;
  insuranceCost?: number;
  maintenanceCost?: number;
  /** null clears the assignment (driver select "Sin chofer"). */
  driverId?: string | null;
  notes?: string;
}

export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;

export const vehiclesApi = {
  /** Active vehicles by default; `includeInactive` returns every vehicle. */
  list(includeInactive = false): Promise<Vehicle[]> {
    const params = includeInactive ? { includeInactive: 'true' } : undefined;
    return api.get<Vehicle[]>('/v1/vehicles', params);
  },

  /** GET /:id returns the aggregated detail (costs, stats, recent routes). */
  get(id: string): Promise<VehicleDetail> {
    return api.get<VehicleDetail>(`/v1/vehicles/${id}`);
  },

  /** Alias of `get` — the backend detail endpoint IS the single-vehicle read. */
  getDetail(id: string): Promise<VehicleDetail> {
    return api.get<VehicleDetail>(`/v1/vehicles/${id}`);
  },

  create(data: CreateVehiclePayload): Promise<Vehicle> {
    return api.post<Vehicle>('/v1/vehicles', data);
  },

  update(id: string, data: UpdateVehiclePayload): Promise<Vehicle> {
    return api.put<Vehicle>(`/v1/vehicles/${id}`, data);
  },

  /** Toggles the vehicle status (active ↔ inactive). */
  setStatus(id: string, active: boolean): Promise<Vehicle> {
    return api.patch<Vehicle>(`/v1/vehicles/${id}/status`, {
      status: active ? 'active' : 'inactive'
    });
  },
};