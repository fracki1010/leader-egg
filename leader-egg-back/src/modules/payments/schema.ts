import { z } from 'zod';
import { businessDateSchema } from '../../utils/business-date.js';

export const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['cash', 'transfer', 'check']).default('cash'),
  // Optional money-account override — defaults to the method mapping server-side.
  account: z.enum(['cash', 'mp', 'bank']).optional(),
  reference: z.string().trim().max(100).optional(),
  date: businessDateSchema.optional()
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
