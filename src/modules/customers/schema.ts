import { z } from 'zod';

const creditConfigSchema = z.object({
  limit: z.number().min(0).default(0),
  termDays: z.number().int().min(0).default(0)
});

// GeoJSON Point — coordinates are [lng, lat] (longitude first)
const geoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()])
});

// Structured address fields — all optional, trimmed. `address` (the composed
// display string) stays the only REQUIRED address field.
const addressDetailSchema = z.object({
  street: z.string().trim().optional(),
  number: z.string().trim().optional(),
  floor: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  province: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  reference: z.string().trim().optional()
});

// Base schema shared by create and update
const baseCustomerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['B2B', 'B2C']),
  phone: z.string().trim().min(1, 'Phone is required'),
  address: z.string().trim().min(1, 'Address is required'),
  addressDetail: addressDetailSchema.optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  taxId: z.string().trim().optional(),
  location: geoPointSchema.optional(),
  creditConfig: creditConfigSchema.optional()
});

// taxId (CUIT/CUIL) is optional for all customer types
export const createCustomerSchema = baseCustomerSchema;

// Updates can modify any field; taxId remains optional
export const updateCustomerSchema = baseCustomerSchema.partial();

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

// Query schema for GET /customers — search, filters, and pagination.
// `includeInactive` is the legacy boolean (kept working); explicit `status` wins over it.
export const listCustomersQuerySchema = z.object({
  search: z.string().trim().optional(),
  type: z.enum(['B2B', 'B2C']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  page: z.coerce.number().int().positive().optional()
});

// Query schema for GET /customers/:id/orders
export const listCustomerOrdersQuerySchema = z.object({
  status: z.enum(['pending', 'assigned', 'in_transit', 'delivered', 'cancelled']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  page: z.coerce.number().int().positive().optional()
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type ListCustomerOrdersQuery = z.infer<typeof listCustomerOrdersQuerySchema>;
