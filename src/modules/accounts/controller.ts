import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { listAccounts, getAccountMovements } from './service.js';
import { listAccountsQuerySchema, listAccountOrdersQuerySchema } from './schema.js';

export const listAccountsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listAccountsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const result = await listAccounts({
      onlyDebtors: parsed.data.onlyDebtors === 'true',
      overdueOnly: parsed.data.overdueOnly === 'true',
      search: parsed.data.search,
      status: parsed.data.status,
      sort: parsed.data.sort,
      limit: parsed.data.limit ?? 50,
      page: parsed.data.page ?? 1
    });
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getAccountMovementsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listAccountOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const customerId = request.params.customerId as string;
    const result = await getAccountMovements(customerId, {
      limit: parsed.data.limit ?? 50,
      page: parsed.data.page ?? 1
    });
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};