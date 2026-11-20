import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { listMovements, getCashSummary } from './service.js';
import { movementFilterSchema } from './schema.js';

/** GET /api/v1/cash/movements — unified, filterable, paginated ledger. */
export const listMovementsHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = movementFilterSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const result = await listMovements(parsed.data);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/cash/summary — per-account position + today's flow. */
export const getSummaryHandler = async (
  _request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const summary = await getCashSummary();
    response.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};
