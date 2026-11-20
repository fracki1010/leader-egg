import { z } from 'zod';

export const MONEY_ACCOUNTS = ['cash', 'mp', 'bank'] as const;
export const MOVEMENT_TYPES = [
  'payment',
  'expense',
  'adjustment',
  'purchase_payment',
  'refund'
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Filters for the unified cash-movements list. `from`/`to` are calendar dates:
 * `from` is snapped to the start of its day and `to` to the end of its day, so
 * a date-only value like `2026-10-18` is inclusive of the whole day.
 */
export const movementFilterSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    account: z.enum(MONEY_ACCOUNTS).optional(),
    type: z.enum(MOVEMENT_TYPES).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(50)
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

export type MovementFilterInput = z.infer<typeof movementFilterSchema>;
