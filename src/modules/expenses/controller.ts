import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createExpense,
  listExpenses,
  getExpenseTotals,
  deleteExpense
} from './service.js';
import {
  createExpenseSchema,
  expenseFilterSchema,
  expenseTotalsSchema
} from './schema.js';

export const createExpenseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createExpenseSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const expense = await createExpense(parsed.data, request.user!.userId);
    response.status(201).json(expense);
  } catch (error) {
    next(error);
  }
};

export const listExpensesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = expenseFilterSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const result = await listExpenses(parsed.data);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getTotalsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = expenseTotalsSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const totals = await getExpenseTotals(parsed.data.period, parsed.data.date);
    response.status(200).json(totals);
  } catch (error) {
    next(error);
  }
};

export const deleteExpenseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deleteExpense(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
