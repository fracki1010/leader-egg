import { AppError } from '../../middleware/error-handler.js';
import { startOfCalendarDay, endOfCalendarDay } from '../../utils/calendar-day.js';
import { Expense, type IExpense, type ExpenseCategory } from './model.js';
import type { CreateExpenseInput, ExpenseFilterInput } from './schema.js';

export const createExpense = async (
  input: CreateExpenseInput,
  userId: string
): Promise<IExpense> => {
  const expense = await Expense.create({
    amount: input.amount,
    category: input.category,
    account: input.account ?? 'cash',
    date: input.date,
    description: input.description,
    reference: input.reference,
    vehicleId: input.vehicleId ?? null,
    createdBy: userId
  });

  return expense;
};

export const listExpenses = async (
  filters: ExpenseFilterInput
): Promise<{ expenses: IExpense[]; total: number; page: number; limit: number }> => {
  const query: Record<string, unknown> = {};

  if (filters.startDate || filters.endDate) {
    // Same local-day snapping as the cash ledger: `endDate` is inclusive of
    // the whole day, and noon-anchored (business-date) values are not excluded.
    const dateFilter: Record<string, Date> = {};
    if (filters.startDate) dateFilter.$gte = startOfCalendarDay(filters.startDate);
    if (filters.endDate) dateFilter.$lte = endOfCalendarDay(filters.endDate);
    query.date = dateFilter;
  }

  if (filters.category) {
    query.category = filters.category;
  }

  const page = filters.page;
  const limit = filters.limit;
  const skip = (page - 1) * limit;

  const [expenses, total] = await Promise.all([
    Expense.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Expense.countDocuments(query)
  ]);

  return { expenses, total, page, limit };
};

export interface ExpenseTotals {
  total: number;
  count: number;
  breakdown: Record<ExpenseCategory, number>;
  weekStart?: string;
  weekEnd?: string;
}

export const getExpenseTotals = async (
  period: 'monthly' | 'weekly',
  date?: Date
): Promise<ExpenseTotals> => {
  const targetDate = date ?? new Date();
  let startDate: Date;
  let endDate: Date;

  if (period === 'monthly') {
    // Local (ART) month boundaries — the business closes months on its own
    // calendar, not on UTC. Using getUTC* shifted a late-evening expense into
    // the next month.
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    startDate = new Date(year, month, 1);
    endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
  } else {
    // Weekly: start from Monday (local calendar)
    const day = targetDate.getDay();
    const diff = day === 0 ? 6 : day - 1; // Adjust for Sunday
    startDate = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate() - diff
    );
    endDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + 6,
      23, 59, 59, 999
    );
  }

  const expenses = await Expense.find({
    date: { $gte: startDate, $lte: endDate }
  });

  const breakdown = {} as Record<ExpenseCategory, number>;
  let total = 0;

  for (const expense of expenses) {
    const amount = Math.round(expense.amount * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    breakdown[expense.category] = Math.round(((breakdown[expense.category] ?? 0) + amount) * 100) / 100;
  }

  const result: ExpenseTotals = {
    total,
    count: expenses.length,
    breakdown
  };

  if (period === 'weekly') {
    result.weekStart = startDate.toISOString().split('T')[0];
    result.weekEnd = endDate.toISOString().split('T')[0];
  }

  return result;
};

export const deleteExpense = async (id: string): Promise<void> => {
  const result = await Expense.findByIdAndDelete(id);
  if (!result) {
    throw new AppError('Expense not found', 404);
  }
};
