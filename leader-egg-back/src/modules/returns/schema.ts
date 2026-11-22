import { z } from 'zod';

export const createReturnSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1, 'Product ID is required'),
        quantity: z.number().int().positive('Quantity must be a positive integer')
      })
    )
    .min(1, 'At least one item is required'),
  reason: z.enum(['broken', 'difference', 'product_change', 'other']),
  effect: z.enum(['refund_cash', 'refund_transfer', 'reduce_debt', 'no_refund']),
  // Optional partial refund — defaults to the full returnedAmount when the
  // effect is a refund (capped at what was actually paid).
  refundAmount: z.number().nonnegative('refundAmount must be non-negative').optional(),
  // Optional money-account override for the refund — omitted defaults to the
  // effect mapping (refund_cash→cash, refund_transfer→mp) server-side.
  refundAccount: z.enum(['cash', 'mp', 'bank']).optional(),
  notes: z.string().trim().max(500).optional()
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const listReturnsQuerySchema = z.object({
  customerId: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  reason: z.enum(['broken', 'difference', 'product_change', 'other']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional()
});

export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;