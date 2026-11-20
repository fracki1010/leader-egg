import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  previewClose,
  createClose,
  updateClose,
  getCloseByDate,
  listCloses
} from './service.js';
import {
  createDailyCloseSchema,
  updateDailyCloseSchema,
  previewCloseSchema,
  dailyCloseFilterSchema,
  dailyCloseDateParamSchema
} from './schema.js';

export const previewCloseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = previewCloseSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const summary = await previewClose(parsed.data.date, parsed.data.channel);
    response.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};

export const createCloseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createDailyCloseSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const user = request.user ? { userId: request.user.userId, role: request.user.role } : undefined;
    const close = await createClose(parsed.data, request.user!.userId, user);
    response.status(201).json(close);
  } catch (error) {
    next(error);
  }
};

export const updateCloseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateDailyCloseSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const close = await updateClose(request.params.id as string, parsed.data);
    response.status(200).json(close);
  } catch (error) {
    next(error);
  }
};

export const getCloseByDateHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsedDate = dailyCloseDateParamSchema.safeParse(request.params);
    if (!parsedDate.success) {
      throw new AppError(parsedDate.error.issues.map((i) => i.message).join('; '), 400);
    }

    // channel is optional — GET /:date?channel=puesto selects the stall close.
    const parsedQuery = previewCloseSchema.safeParse(request.query);
    if (!parsedQuery.success) {
      throw new AppError(parsedQuery.error.issues.map((i) => i.message).join('; '), 400);
    }

    const close = await getCloseByDate(parsedDate.data.date, parsedQuery.data.channel);
    response.status(200).json(close);
  } catch (error) {
    next(error);
  }
};

export const listClosesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = dailyCloseFilterSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const closes = await listCloses(parsed.data);
    response.status(200).json(closes);
  } catch (error) {
    next(error);
  }
};
