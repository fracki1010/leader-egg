import { z } from 'zod';
import { businessDateSchema } from '../../utils/business-date.js';

export const EXPENSE_CATEGORIES = [
  'fuel',
  'salary',
  'maintenance',
  'supplies',
  'other',
  'repair',
  'insurance'
] as const;

export const createExpenseSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  category: z.enum(EXPENSE_CATEGORIES),
  // Money account the expense is paid from — omitted defaults to 'cash'.
  account: z.enum(['cash', 'mp', 'bank']).optional(),
  date: businessDateSchema.optional().default(() => new Date()),
  description: z.string().trim().min(1).max(200),
  reference: z.string().trim().optional(),
  vehicleId: z.string().trim().min(1).optional()
});

export const expenseFilterSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return data.startDate <= data.endDate;
    }
    return true;
  },
  { message: 'startDate must be before or equal to endDate', path: ['endDate'] }
);

export const expenseTotalsSchema = z.object({
  period: z.enum(['monthly', 'weekly']),
  // `date=YYYY-MM` or `YYYY-MM-DD` must resolve to the LOCAL calendar period,
  // not to UTC midnight (which is the previous day in ART).
  date: businessDateSchema.optional()
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ExpenseFilterInput = z.infer<typeof expenseFilterSchema>;
export type ExpenseTotalsInput = z.infer<typeof expenseTotalsSchema>;
