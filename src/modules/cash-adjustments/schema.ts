import { z } from 'zod';
import { businessDateSchema } from '../../utils/business-date.js';

export const MONEY_ACCOUNTS = ['cash', 'mp', 'bank'] as const;
export const CASH_ADJUSTMENT_REASONS = ['correction', 'cash_count', 'missing', 'found', 'other'] as const;
export const ADJUSTMENT_CHANNELS = ['reparto', 'puesto'] as const;

/** Signed amount: any finite number except 0 (negative removes money). */
const signedNonZeroAmount = z
  .number()
  .refine((value) => Number.isFinite(value) && value !== 0, {
    message: 'Amount must be a non-zero number'
  });

export const createAdjustmentSchema = z.object({
  // Money account the movement hits.
  account: z.enum(MONEY_ACCOUNTS),
  // SIGNED: positive adds money, negative removes it.
  amount: signedNonZeroAmount,
  reason: z.enum(CASH_ADJUSTMENT_REASONS),
  note: z.string().trim().max(300).optional(),
  // Omitted defaults to 'reparto'.
  channel: z.enum(ADJUSTMENT_CHANNELS).optional(),
  // Omitted defaults to now.
  date: businessDateSchema.optional()
});

export const adjustmentFilterSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    account: z.enum(MONEY_ACCOUNTS).optional(),
    createdBy: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    { message: 'from must be before or equal to to', path: ['to'] }
  );

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type AdjustmentFilterInput = z.infer<typeof adjustmentFilterSchema>;
