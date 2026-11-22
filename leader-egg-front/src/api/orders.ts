import { api } from './client.ts';
import type {
  Order,
  OrderStatus,
  OrderChannel,
  PaymentStatus,
  PaymentPreference,
  SalesChannel,
  BonificationType,
  SurchargeType,
  CancelMoneyAction,
  CustomerOutstanding,
  LatLng,
  PaymentLinePayload,
  PriceUnit,
} from '../types/index.ts';

export interface CreateOrderItemPayload {
  productId: string;
  quantity: number;
  /** 'maple' (default) or 'cajon'. */
  unit?: PriceUnit;
}

/** Upfront payment recorded as a REAL Payment doc at order creation (partial preference). */
export type InitialPaymentPayload = PaymentLinePayload;

/**
 * Order-level bonification: a fixed money amount or a percentage of the order
 * subtotal. The server derives the money discount from the priced subtotal.
 */
export interface BonificationPayload {
  type: BonificationType;
  /** $ for 'amount' (must be ≤ subtotal) or 0-100 for 'percent'. */
  value: number;
}

/**
 * Order-level surcharge: a fixed money amount or a percentage of the order
 * subtotal. The server derives the money surcharge from the priced subtotal.
 */
export interface SurchargePayload {
  type: SurchargeType;
  /** $ for 'amount' or 0-100 for 'percent'. */
  value: number;
}

export interface CreateOrderPayload {
  customerId: string;
  channel: OrderChannel;
  deliveryAddress?: string;
  deliveryNotes?: string;
  /** Coordinates resolved via "Buscar en mapa" (POST /v1/geocode). */
  deliveryLocation?: LatLng;
  /** Business/sale date (YYYY-MM-DD). Omit → backend defaults to now. */
  orderDate?: string;
  /** Date the customer wants the delivery (YYYY-MM-DD). Omit/undefined → backend defaults to null. */
  deliveryDate?: string | null;
  /** Payment preference — omitted defaults to 'cash' (backward compatible). */
  paymentPreference?: PaymentPreference;
  /** Sales channel — omitted defaults to 'reparto' (backend is the default source). */
  salesChannel?: SalesChannel;
  /** Initial status — 'delivered' consumes stock immediately server-side. */
  status?: 'pending' | 'delivered';
  /** Optional REAL upfront payment (partial preference). */
  initialPayment?: InitialPaymentPayload;
  /**
   * Optional SPLIT upfront payments (partial preference): each line becomes its
   * own Payment doc server-side. Takes precedence over `initialPayment`.
   */
  initialPayments?: InitialPaymentPayload[];
  /** Optional order-level discount — omitted when empty/zero. */
  bonification?: BonificationPayload;
  /** Optional order-level surcharge — omitted when empty/zero. */
  surcharge?: SurchargePayload;
  /** Explicit confirmation to create an identical order inside the 5-min window. */
  forceDuplicate?: boolean;
  items: CreateOrderItemPayload[];
}

/** Filters for GET /v1/orders (server-side filtering + pagination). */
export interface OrderListFilters {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  customerId?: string;
  channel?: OrderChannel;
  /** Inclusive start date (YYYY-MM-DD, local calendar day). */
  from?: string;
  /** Inclusive end date (YYYY-MM-DD, local calendar day). */
  to?: string;
  /** Case-insensitive match on orderNumber or customerName. */
  search?: string;
  /** Max 200 (backend clamps). */
  limit?: number;
  page?: number;
}

/** Envelope returned by GET /v1/orders. */
export interface OrderListResult {
  items: Order[];
  total: number;
  page: number;
  limit: number;
}

/** Result of GET /v1/orders/today. */
export interface TodayOrdersResult {
  orders: Order[];
  summary: { total: number; count: number };
}

/** Payload for PATCH /v1/orders/:id (edit channel + items + payment preference while pending). */
export interface UpdateOrderPayload {
  channel?: OrderChannel;
  items?: CreateOrderItemPayload[];
  /** Business/sale date (YYYY-MM-DD) — editable while the order is pending. */
  orderDate?: string;
  /** Payment preference — changeable while the order is pending. */
  paymentPreference?: PaymentPreference;
  /** Sales channel — changeable while the order is pending. */
  salesChannel?: SalesChannel;
}

export const ordersApi = {
  list(filters?: OrderListFilters): Promise<OrderListResult> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.paymentStatus) params.paymentStatus = filters.paymentStatus;
    if (filters?.customerId) params.customerId = filters.customerId;
    if (filters?.channel) params.channel = filters.channel;
    if (filters?.from) params.from = filters.from;
    if (filters?.to) params.to = filters.to;
    if (filters?.search) params.search = filters.search;
    if (filters?.limit !== undefined) params.limit = String(filters.limit);
    if (filters?.page !== undefined) params.page = String(filters.page);
    return api.get<OrderListResult>('/v1/orders', params);
  },

  listOverdue(): Promise<Order[]> {
    return api.get<Order[]>('/v1/orders', { overdue: 'true' });
  },

  /** Today's orders + summary { total, count }. */
  getToday(): Promise<TodayOrdersResult> {
    return api.get<TodayOrdersResult>('/v1/orders/today');
  },

  get(id: string): Promise<Order> {
    return api.get<Order>(`/v1/orders/${id}`);
  },

  create(data: CreateOrderPayload): Promise<Order> {
    return api.post<Order>('/v1/orders', data);
  },

  /** Edit channel + items — only allowed while the order is pending. */
  update(id: string, data: UpdateOrderPayload): Promise<Order> {
    return api.patch<Order>(`/v1/orders/${id}`, data);
  },

  /** Delete a pending order (409 if delivered/assigned/with payments). */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/orders/${id}`);
  },

  transitionStatus(
    id: string,
    status: OrderStatus,
    moneyAction?: CancelMoneyAction,
  ): Promise<Order> {
    return api.patch<Order>(`/v1/orders/${id}/status`, {
      status,
      ...(moneyAction !== undefined ? { moneyAction } : {}),
    });
  },

  getCustomerOutstanding(customerId: string): Promise<CustomerOutstanding> {
    return api.get<CustomerOutstanding>(`/v1/orders/customers/${customerId}/outstanding`);
  }
};