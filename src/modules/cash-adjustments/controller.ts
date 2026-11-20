import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { createAdjustment, listAdjustments } from './service.js';
import { createAdjustmentSchema, adjustmentFilterSchema } from './schema.js';

export const createAdjustmentHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createAdjustmentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const adjustment = await createAdjustment(parsed.data, request.user!.userId);
    response.status(201).json(adjustment);
  } catch (error) {
    next(error);
  }
};

export const listAdjustmentsHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = adjustmentFilterSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const result = await listAdjustments(parsed.data);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
