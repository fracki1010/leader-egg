import { api } from './client.ts';
import type {
  PriceUnit,
  Product,
  ProductCaliber,
  ProductOptions,
  ProductVariety,
  PriceEntry,
} from '../types/index.ts';

export interface CreateProductPayload {
  variety: ProductVariety;
  caliber: ProductCaliber;
  eggsPerMaple?: number;
  maplesPerCajon?: number;
  costPrice?: number | null;
  lowStockThreshold?: number;
  /** Opening stock (maples) for the auto-created inventory record. */
  initialQuantity?: number;
}

export interface UpdateProductPayload {
  variety?: ProductVariety;
  caliber?: ProductCaliber;
  /** Cost per maple — used for stock value / margins. */
  costPrice?: number | null;
  /** How many maples fit in one cajón (box). */
  maplesPerCajon?: number;
  lowStockThreshold?: number;
}

export interface ProductListFilters {
  variety?: ProductVariety;
  caliber?: ProductCaliber;
}

export interface CreatePricePayload {
  price: number;
  /** 'maple' (default) or 'cajon'. */
  unit?: PriceUnit;
  effectiveFrom: string;
  effectiveTo?: string;
}

export const productsApi = {
  list(filters: ProductListFilters = {}): Promise<Product[]> {
    const params: Record<string, string> = {};
    if (filters.variety) params.variety = filters.variety;
    if (filters.caliber) params.caliber = filters.caliber;
    return api.get<Product[]>('/v1/products', params);
  },

  get(id: string): Promise<Product> {
    return api.get<Product>(`/v1/products/${id}`);
  },

  create(data: CreateProductPayload): Promise<Product> {
    return api.post<Product>('/v1/products', data);
  },

  /** PATCH /v1/products/:id — update product fields (costPrice, maplesPerCajon, threshold). */
  update(id: string, data: UpdateProductPayload): Promise<Product> {
    return api.patch<Product>(`/v1/products/${id}`, data);
  },

  /** DELETE /v1/products/:id — remove the product (204). */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/products/${id}`);
  },

  /** GET /v1/products/options — variety×caliber catalog with labels. */
  getOptions(): Promise<ProductOptions> {
    return api.get<ProductOptions>('/v1/products/options');
  },

  listPrices(productId: string): Promise<PriceEntry[]> {
    return api.get<PriceEntry[]>(`/v1/products/${productId}/prices`);
  },

  getActivePrice(productId: string, unit?: PriceUnit, date?: string): Promise<PriceEntry> {
    const params: Record<string, string> = {};
    if (unit) params.unit = unit;
    if (date) params.date = date;
    return api.get<PriceEntry>(`/v1/products/${productId}/prices/active`, params);
  },

  createPrice(productId: string, data: CreatePricePayload): Promise<PriceEntry> {
    return api.post<PriceEntry>(`/v1/products/${productId}/prices`, data);
  }
};
