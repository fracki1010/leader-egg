import { z } from 'zod';
import { CALIBERS, VARIETIES } from './model.js';
import { PRODUCT_UNIT_ENUM } from './units.js';

export const createProductSchema = z.object({
  variety: z.enum(VARIETIES),
  caliber: z.enum(CALIBERS),
  eggsPerMaple: z.number().int().positive().default(30),
  maplesPerCajon: z.number().int().min(1, 'maplesPerCajon must be at least 1').default(12),
  costPrice: z.number().positive('Cost price must be positive').nullable().optional(),
  lowStockThreshold: z.number().int().min(0).default(20),
  /** Optional opening stock (maples) for the auto-created inventory record. */
  initialQuantity: z.number().int().min(0).default(0)
});

/** General product update — each field is optional; only present fields are applied. */
export const updateProductSchema = z.object({
  variety: z.enum(VARIETIES).optional(),
  caliber: z.enum(CALIBERS).optional(),
  costPrice: z.number().positive('Cost price must be positive').nullable().optional(),
  maplesPerCajon: z.number().int().min(1, 'maplesPerCajon must be at least 1').optional(),
  lowStockThreshold: z.number().int().min(0).optional()
});

export const createPriceEntrySchema = z.object({
  price: z.number().positive('Price must be positive'),
  unit: z.enum(PRODUCT_UNIT_ENUM).default('maple'),
  effectiveFrom: z.coerce.date().optional().default(() => new Date()),
  effectiveTo: z.coerce.date().nullable().default(null)
}).refine(
  (data) => {
    if (data.effectiveTo === null) return true;
    return data.effectiveTo > data.effectiveFrom;
  },
  { message: 'effectiveTo must be after effectiveFrom', path: ['effectiveTo'] }
);

/** Query filters for listing products (by variety and/or caliber). */
export const listProductsQuerySchema = z.object({
  variety: z.enum(VARIETIES).optional(),
  caliber: z.enum(CALIBERS).optional()
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreatePriceEntryInput = z.infer<typeof createPriceEntrySchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
