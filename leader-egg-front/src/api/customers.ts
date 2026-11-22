import { api } from './client.ts';
import type {
  AddressDetail,
  Customer,
  CustomerListResult,
  CustomerOrdersResult,
  CustomerStatus,
  CustomerSummary,
  CustomerType,
  GeoPoint,
} from '../types/index.ts';

export interface CreateCustomerPayload {
  name: string;
  type: CustomerType;
  phone: string;
  address: string;
  addressDetail?: AddressDetail;
  /** Geocoded point as GeoJSON — coordinates [lng, lat]. */
  location?: GeoPoint;
  email?: string;
  taxId?: string;
  creditConfig?: { limit: number; termDays: number };
}

export interface UpdateCustomerPayload {
  name?: string;
  type?: CustomerType;
  phone?: string;
  address?: string;
  addressDetail?: AddressDetail;
  location?: GeoPoint;
  email?: string;
  taxId?: string;
  creditConfig?: { limit: number; termDays: number };
}

export interface CustomerListFilters {
  search?: string;
  type?: CustomerType;
  status?: CustomerStatus;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
}

export interface CustomerOrdersFilters {
  status?: string;
  limit?: number;
  page?: number;
}

export const customersApi = {
  /**
   * Legacy list — returns ALL matching customers as a plain array.
   * Backward-compatible with the pre-pagination API. Prefer `listFiltered`
   * for search/type/status filtering.
   */
  list(includeInactive = false): Promise<Customer[]> {
    return api.get<Customer[]>('/v1/customers', {
      includeInactive: String(includeInactive)
    });
  },

  /**
   * Filtered list with search (name/phone/taxId), type and status.
   * Without page/limit the backend returns a plain array (backward compat);
   * with page/limit it returns { items, total, page, limit }.
   */
  listFiltered(filters: CustomerListFilters = {}): Promise<Customer[] | CustomerListResult> {
    const params: Record<string, string> = {};
    if (filters.search) params.search = filters.search;
    if (filters.type) params.type = filters.type;
    if (filters.status) params.status = filters.status;
    if (filters.includeInactive) params.includeInactive = 'true';
    if (filters.page !== undefined) params.page = String(filters.page);
    if (filters.limit !== undefined) params.limit = String(filters.limit);
    return api.get<Customer[] | CustomerListResult>('/v1/customers', params);
  },

  get(id: string): Promise<Customer> {
    return api.get<Customer>(`/v1/customers/${id}`);
  },

  /** Aggregated dashboard summary for a single customer. */
  getSummary(id: string): Promise<CustomerSummary> {
    return api.get<CustomerSummary>(`/v1/customers/${id}/summary`);
  },

  /** Paginated order history for a customer, sorted by createdAt desc. */
  getOrders(id: string, filters: CustomerOrdersFilters = {}): Promise<CustomerOrdersResult> {
    const params: Record<string, string> = {};
    if (filters.status) params.status = filters.status;
    if (filters.limit !== undefined) params.limit = String(filters.limit);
    if (filters.page !== undefined) params.page = String(filters.page);
    return api.get<CustomerOrdersResult>(`/v1/customers/${id}/orders`, params);
  },

  create(data: CreateCustomerPayload): Promise<Customer> {
    return api.post<Customer>('/v1/customers', data);
  },

  update(id: string, data: UpdateCustomerPayload): Promise<Customer> {
    return api.put<Customer>(`/v1/customers/${id}`, data);
  },

  updateStatus(id: string, status: CustomerStatus): Promise<Customer> {
    return api.patch<Customer>(`/v1/customers/${id}/status`, { status });
  },

  /** Hard-deletes a customer. 409 when the customer has order history. */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/customers/${id}`);
  }
};