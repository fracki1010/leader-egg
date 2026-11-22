import { z } from 'zod';

// Base schema shared by create and update. Only `name` is required — the
// scenarios validate exactly that (201 with name; 400 without name).
export const createSupplierSchema = z.object({
  name: z.string().trim().min(2).max(100),
  contact: z.string().trim().max(100).optional().default(''),
  phone: z.string().trim().max(50).optional().default('')
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

// Query schema for GET /suppliers — active-only by default unless
// `includeInactive=true` is passed.
export const listSuppliersQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional()
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type UpdateSupplierStatusInput = z.infer<typeof updateStatusSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;