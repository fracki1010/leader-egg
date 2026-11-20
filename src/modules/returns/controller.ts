import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { createReturn, listReturns, listReturnsForOrder } from './service.js';
import { createReturnSchema, listReturnsQuerySchema } from './schema.js';

export const createReturnHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createReturnSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    if (!request.user) {
      throw new AppError('Authentication required', 401);
    }

    const orderId = request.params.id as string;
    const user = { userId: request.user.userId, role: request.user.role };
    const returnDoc = await createReturn(orderId, parsed.data, user);
    response.status(201).json(returnDoc);
  } catch (error) {
    next(error);
  }
};

export const listReturnsForOrderHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const orderId = request.params.id as string;
    const returns = await listReturnsForOrder(orderId);
    response.status(200).json(returns);
  } catch (error) {
    next(error);
  }
};

export const listReturnsHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = listReturnsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const result = await listReturns(parsed.data);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};