import { api } from './client.ts';
import type { Supplier } from '../types/index.ts';

export interface CreateSupplierPayload {
  name: string;
  contact?: string;
  phone?: string;
}

export interface UpdateSupplierPayload {
  name?: string;
  contact?: string;
  phone?: string;
}

export const suppliersApi = {
  /** Active suppliers by default; `includeInactive` returns every supplier. */
  list(includeInactive = false): Promise<Supplier[]> {
    const params = includeInactive ? { includeInactive: 'true' } : undefined;
    return api.get<Supplier[]>('/v1/suppliers', params);
  },

  get(id: string): Promise<Supplier> {
    return api.get<Supplier>(`/v1/suppliers/${id}`);
  },

  create(data: CreateSupplierPayload): Promise<Supplier> {
    return api.post<Supplier>('/v1/suppliers', data);
  },

  update(id: string, data: UpdateSupplierPayload): Promise<Supplier> {
    return api.put<Supplier>(`/v1/suppliers/${id}`, data);
  },

  /** Toggles the supplier status (active ↔ inactive). */
  updateStatus(id: string, active: boolean): Promise<Supplier> {
    return api.patch<Supplier>(`/v1/suppliers/${id}/status`, {
      status: active ? 'active' : 'inactive'
    });
  },

  /** Hard-deletes a supplier. 409 when the supplier has purchase history. */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/suppliers/${id}`);
  }
};