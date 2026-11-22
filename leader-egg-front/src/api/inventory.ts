import { api } from './client.ts';
import type {
  InventoryItem,
  Product,
  StockTransaction,
  TransactionType,
} from '../types/index.ts';

export interface AdjustStockPayload {
  quantity: number;
  notes?: string;
}

export interface CreateInventoryPayload {
  productId: string;
  quantity?: number;
  lowStockThreshold?: number;
}

export interface UpdateThresholdPayload {
  lowStockThreshold: number;
}

export interface TransactionFilters {
  productId?: string;
  type?: TransactionType;
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}

export interface TransactionListResult {
  items: StockTransaction[];
  total: number;
  page: number;
  limit: number;
}

export interface ClassifyTarget {
  productId: string;
  /** Maples — the inventory unit. */
  quantity: number;
}

export interface ClassifyPayload {
  to: ClassifyTarget[];
  notes?: string;
}

export interface ClassifyResult {
  source: InventoryItem;
  targets: InventoryItem[];
  referenceId: string;
}

export const inventoryApi = {
  getAll(): Promise<InventoryItem[]> {
    return api.get<InventoryItem[]>('/v1/inventory');
  },

  getByProduct(productId: string): Promise<InventoryItem> {
    return api.get<InventoryItem>(`/v1/inventory/${productId}`);
  },

  /** POST /v1/inventory — create an inventory record for a product (409 if it already exists) */
  create(data: CreateInventoryPayload): Promise<InventoryItem> {
    return api.post<InventoryItem>('/v1/inventory', data);
  },

  /** DELETE /v1/inventory/:productId — remove the inventory record (204) */
  remove(productId: string): Promise<void> {
    return api.delete<void>(`/v1/inventory/${productId}`);
  },

  adjustStock(productId: string, data: AdjustStockPayload): Promise<InventoryItem> {
    return api.patch<InventoryItem>(`/v1/inventory/${productId}`, data);
  },

  /** POST /v1/inventory/:productId/increment — stock entry (purchase transaction) */
  incrementStock(productId: string, data: AdjustStockPayload): Promise<InventoryItem> {
    return api.post<InventoryItem>(`/v1/inventory/${productId}/increment`, data);
  },

  /** POST /v1/inventory/:productId/decrement — stock exit (manual adjustment, guarded ≥ 0) */
  decrementStock(productId: string, data: AdjustStockPayload): Promise<InventoryItem> {
    return api.post<InventoryItem>(`/v1/inventory/${productId}/decrement`, data);
  },

  /** POST /v1/inventory/:fromProductId/classify — split a product's stock into typed products (admin). */
  classify(fromProductId: string, data: ClassifyPayload): Promise<ClassifyResult> {
    return api.post<ClassifyResult>(`/v1/inventory/${fromProductId}/classify`, data);
  },

  getTransactions(productId: string): Promise<StockTransaction[]> {
    return api.get<StockTransaction[]>(`/v1/inventory/${productId}/transactions`);
  },

  /** GET /v1/inventory/transactions — paginated, filterable transaction list */
  listTransactions(filters: TransactionFilters = {}): Promise<TransactionListResult> {
    const params: Record<string, string> = {};
    if (filters.productId) params.productId = filters.productId;
    if (filters.type) params.type = filters.type;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.limit) params.limit = String(filters.limit);
    if (filters.page) params.page = String(filters.page);
    return api.get<TransactionListResult>('/v1/inventory/transactions', params);
  },

  /** PATCH /v1/inventory/:productId/threshold — update low stock threshold (stored on the product) */
  updateThreshold(productId: string, lowStockThreshold: number): Promise<Product> {
    return api.patch<Product>(`/v1/inventory/${productId}/threshold`, {
      lowStockThreshold,
    } satisfies UpdateThresholdPayload);
  },
};