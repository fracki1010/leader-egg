import { api } from './client.ts';
import type { CustomerCharge, CreateCustomerChargeRequest } from '../types/index.ts';

/**
 * Manual customer charges (cuenta corriente / fiado). Admin-only on the
 * backend; the ledger is append-only — corrections are opposite entries.
 */
export const customerChargesApi = {
  /** Register a manual charge/credit against a customer. */
  create(customerId: string, data: CreateCustomerChargeRequest): Promise<CustomerCharge> {
    return api.post<CustomerCharge>(`/v1/customers/${customerId}/charges`, data);
  },

  /** Newest-first charge history for one customer. */
  list(customerId: string): Promise<CustomerCharge[]> {
    return api.get<CustomerCharge[]>(`/v1/customers/${customerId}/charges`);
  },
};
