import { z } from 'zod';
import { businessDateSchema } from '../../utils/business-date.js';

export const CUSTOMER_CHARGE_TYPES = ['charge', 'credit'] as const;
export const CUSTOMER_CHARGE_REASONS = ['manual_debt', 'adjustment', 'forgiveness', 'other'] as const;

/** Always-positive amount: the sign of the effect comes from `type`. */
const positiveAmount = z
  .number()
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: 'Amount must be a positive number'
  });

export const createCustomerChargeSchema = z.object({
  // 'charge' increases debt, 'credit' reduces it.
  type: z.enum(CUSTOMER_CHARGE_TYPES),
  amount: positiveAmount,
  reason: z.enum(CUSTOMER_CHARGE_REASONS),
  note: z.string().trim().max(300).optional(),
  // Omitted defaults to now.
  date: businessDateSchema.optional()
});

export type CreateCustomerChargeInput = z.infer<typeof createCustomerChargeSchema>;
