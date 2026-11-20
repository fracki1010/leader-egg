import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { recordCustomerPayment } from './service.js';
import { createCustomerPaymentSchema } from './schema.js';

export const recordCustomerPaymentHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createCustomerPaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    if (!request.user) {
      throw new AppError('A valid authenticated user is required', 400);
    }

    const customerId = request.params.id as string;
    const result = await recordCustomerPayment(customerId, parsed.data, request.user.userId);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
};
