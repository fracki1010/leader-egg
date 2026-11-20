import { z } from 'zod';

// Query schema for GET /accounts — consolidated account list filters.
export const listAccountsQuerySchema = z.object({
  onlyDebtors: z.enum(['true', 'false']).optional(),
  overdueOnly: z.enum(['true', 'false']).optional(),
  search: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.enum(['name', 'balance', 'overdue']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  page: z.coerce.number().int().positive().optional()
});

// Query schema for the paginated open-orders block inside GET /accounts/:customerId/movements.
export const listAccountOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  page: z.coerce.number().int().positive().optional()
});

export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;
export type ListAccountOrdersQuery = z.infer<typeof listAccountOrdersQuerySchema>;