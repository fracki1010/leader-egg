import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { createCharge, listCharges } from './service.js';
import { createCustomerChargeSchema } from './schema.js';

export const createCustomerChargeHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createCustomerChargeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    if (!request.user) {
      throw new AppError('Authentication required', 401);
    }

    const customerId = request.params.id as string;
    const charge = await createCharge(customerId, parsed.data, request.user.userId);
    response.status(201).json(charge);
  } catch (error) {
    next(error);
  }
};

export const listCustomerChargesHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const customerId = request.params.id as string;
    const charges = await listCharges(customerId);
    response.status(200).json(charges);
  } catch (error) {
    next(error);
  }
};
