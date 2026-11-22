import { z } from 'zod';
import { PRODUCT_UNIT_ENUM } from '../products/units.js';

export const createPromotionSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    productId: z.string().trim().min(1, 'Product ID is required'),
    description: z.string().trim().max(300).optional().default(''),
    type: z.enum(['fixed_price', 'discount_percent', 'buy_x_get_y']),
    value: z.number().positive('Value must be a positive number'),
    // buy_x_get_y → total units per group ("pagás X llevás Y"); null = legacy value+1
    getQuantity: z.number().int().positive().optional().nullable(),
    unit: z.enum(PRODUCT_UNIT_ENUM).default('maple'),
    // null means "no bound" — sent explicitly to clear a previously set value on update
    minQuantity: z.number().int().positive().optional().nullable(),
    maxQuantity: z.number().int().positive().optional().nullable(),
    stockLimit: z.number().int().positive().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    status: z.enum(['active', 'inactive']).default('active')
  })
  .refine(
    (v) => v.minQuantity == null || v.maxQuantity == null || v.minQuantity <= v.maxQuantity,
    { message: 'minQuantity must be <= maxQuantity', path: ['minQuantity'] }
  )
  .refine(
    (v) => v.type !== 'discount_percent' || v.value <= 100,
    { message: 'discount_percent value must be at most 100', path: ['value'] }
  )
  .refine(
    (v) => v.type !== 'buy_x_get_y' || v.getQuantity == null || v.getQuantity > v.value,
    { message: 'getQuantity must be greater than value (you must get more than you pay)', path: ['getQuantity'] }
  );

// Update schema is built WITHOUT defaults: zod v4's `.partial()` re-applies
// `.default()` values for omitted keys, which would silently reset `status` to
// 'active' / `unit` to 'maple' on every edit. Here every key is optional and
// stays `undefined` when omitted (null still means "clear this bound").
export const updatePromotionSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    productId: z.string().trim().min(1, 'Product ID is required'),
    description: z.string().trim().max(300),
    type: z.enum(['fixed_price', 'discount_percent', 'buy_x_get_y']),
    value: z.number().positive('Value must be a positive number'),
    getQuantity: z.number().int().positive().nullable(),
    unit: z.enum(PRODUCT_UNIT_ENUM),
    minQuantity: z.number().int().positive().nullable(),
    maxQuantity: z.number().int().positive().nullable(),
    stockLimit: z.number().int().positive().nullable(),
    expiresAt: z.coerce.date().nullable(),
    status: z.enum(['active', 'inactive'])
  })
  .partial()
  .refine(
    (v) => v.minQuantity == null || v.maxQuantity == null || v.minQuantity <= v.maxQuantity,
    { message: 'minQuantity must be <= maxQuantity', path: ['minQuantity'] }
  )
  .refine(
    (v) => v.type !== 'discount_percent' || v.value == null || v.value <= 100,
    { message: 'discount_percent value must be at most 100', path: ['value'] }
  )
  .refine(
    (v) => v.type !== 'buy_x_get_y' || v.getQuantity == null || v.value == null || v.getQuantity > v.value,
    { message: 'getQuantity must be greater than value (you must get more than you pay)', path: ['getQuantity'] }
  );

export const updatePromotionStatusSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

export const listPromotionsQuerySchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  productId: z.string().trim().optional()
});

export const listActivePromotionsQuerySchema = z.object({
  productId: z.string().trim().optional(),
  unit: z.enum(PRODUCT_UNIT_ENUM).optional()
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
export type UpdatePromotionStatusInput = z.infer<typeof updatePromotionStatusSchema>;
export type ListPromotionsQuery = z.infer<typeof listPromotionsQuerySchema>;
export type ListActivePromotionsQuery = z.infer<typeof listActivePromotionsQuerySchema>;