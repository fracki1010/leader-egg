import { z } from 'zod';
import { businessDateSchema } from '../../utils/business-date.js';

/**
 * Customer-level payment: one amount is distributed automatically across the
 * customer's open orders, oldest first (FIFO). `method` is required so the
 * allocation is always attributable to a money account.
 */
export const createCustomerPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['cash', 'transfer', 'check']),
  // Optional money-account override — defaults to the method mapping server-side.
  account: z.enum(['cash', 'mp', 'bank']).optional(),
  reference: z.string().trim().max(100).optional(),
  date: businessDateSchema.optional()
});

export type CreateCustomerPaymentInput = z.infer<typeof createCustomerPaymentSchema>;
