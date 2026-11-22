import { api } from './client.ts';
import type { MoneyAccount, PriceUnit, Purchase, PurchaseDetail, PurchasePaymentLine, PurchasePaymentMethod, PurchaseStatus } from '../types/index.ts';

export interface CreatePurchaseItemPayload {
  productId: string;
  /** Quantity in the item's own unit ('maple' or 'cajon'). */
  quantity: number;
  /** 'maple' (default) or 'cajon'. */
  unit?: PriceUnit;
  unitCost: number;
}

export interface CreatePurchasePayload {
  supplierId: string;
  /** ISO date; defaults to today server-side when omitted. */
  date?: string;
  items: CreatePurchaseItemPayload[];
  notes?: string;
  /** Mark delivered right away (stock enters immediately). Default false. */
  delivered?: boolean;
  /** Itemised payment lines recorded at creation (one per method). */
  payments?: PurchasePaymentLine[];
  /** Legacy single-payment shape (kept for back-compat). */
  paymentMethod?: PurchasePaymentMethod;
  /** Money account override — omitted defaults to the paymentMethod mapping server-side. */
  account?: MoneyAccount;
  /** Amount already paid (0 < paidAmount ≤ totalCost). */
  paidAmount?: number;
  /** Explicit confirmation to create an identical purchase inside the 5-min window. */
  forceDuplicate?: boolean;
}

export interface UpdatePurchasePayload {
  supplierId?: string;
  date?: string;
  items?: CreatePurchaseItemPayload[];
  notes?: string;
}

export interface RecordPaymentPayload {
  /** One line per method; all lines share a groupId. Σ ≤ remaining balance. */
  payments: PurchasePaymentLine[];
  /** Optional shared id (generated server-side when omitted). */
  groupId?: string;
}

export interface PurchaseListFilters {
  supplierId?: string;
  /** ISO date — inclusive lower bound on purchase.date. */
  from?: string;
  /** ISO date — inclusive upper bound. Send end-of-day to include the whole day. */
  to?: string;
  status?: PurchaseStatus;
}

export const purchasesApi = {
  list(filters: PurchaseListFilters = {}): Promise<Purchase[]> {
    const params: Record<string, string> = {};
    if (filters.supplierId) params.supplierId = filters.supplierId;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.status) params.status = filters.status;
    return api.get<Purchase[]>('/v1/purchases', params);
  },

  /** Detail with per-item margin (active price − unit cost) + lifecycle fields. */
  get(id: string): Promise<PurchaseDetail> {
    return api.get<PurchaseDetail>(`/v1/purchases/${id}`);
  },

  create(data: CreatePurchasePayload): Promise<Purchase> {
    return api.post<Purchase>('/v1/purchases', data);
  },

  /** Edit a PENDING purchase (supplierId/date/items/notes). 409 otherwise. */
  update(id: string, data: UpdatePurchasePayload): Promise<Purchase> {
    return api.patch<Purchase>(`/v1/purchases/${id}`, data);
  },

  /** Mark delivered: pending → delivered, stock enters. 409 otherwise. */
  deliver(id: string): Promise<Purchase> {
    return api.patch<Purchase>(`/v1/purchases/${id}/deliver`, {});
  },

  /** Cancel: pending → cancelled. 409 otherwise. */
  cancel(id: string): Promise<Purchase> {
    return api.patch<Purchase>(`/v1/purchases/${id}/cancel`, {});
  },

  /** Record a payment against the purchase balance. */
  recordPayment(id: string, data: RecordPaymentPayload): Promise<Purchase> {
    return api.patch<Purchase>(`/v1/purchases/${id}/payment`, data);
  },

  /** Deletes a pending or cancelled purchase. 409 when delivered. */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/purchases/${id}`);
  }
};