import { api } from './client.ts';
import type {
  CreateCustomerPaymentRequest,
  CustomerPaymentResult,
  MoneyAccount,
  Payment,
  Receipt,
} from '../types/index.ts';

export interface CreatePaymentPayload {
  amount: number;
  method: 'cash' | 'transfer' | 'check';
  /** Money account override — omitted defaults to the method mapping server-side. */
  account?: MoneyAccount;
  reference?: string;
}

export const paymentsApi = {
  record(orderId: string, data: CreatePaymentPayload): Promise<Payment> {
    return api.post<Payment>(`/v1/orders/${orderId}/payments`, data);
  },

  /**
   * Customer-level payment: the backend auto-allocates the amount across the
   * customer's open orders oldest-first (FIFO).
   */
  recordCustomerPayment(
    customerId: string,
    data: CreateCustomerPaymentRequest,
  ): Promise<CustomerPaymentResult> {
    return api.post<CustomerPaymentResult>(`/v1/customers/${customerId}/payments`, data);
  },

  list(orderId: string): Promise<Payment[]> {
    return api.get<Payment[]>(`/v1/orders/${orderId}/payments`);
  },

  getReceipt(orderId: string): Promise<Receipt> {
    return api.get<Receipt>(`/v1/orders/${orderId}/receipt`);
  }
};
