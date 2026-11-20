import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createPromotion,
  listPromotions,
  listActivePromotions,
  getPromotionById,
  updatePromotion,
  setPromotionStatus,
  deletePromotion
} from './service.js';
import {
  createPromotionSchema,
  updatePromotionSchema,
  updatePromotionStatusSchema,
  listPromotionsQuerySchema,
  listActivePromotionsQuerySchema
} from './schema.js';

export const createPromotionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createPromotionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const promo = await createPromotion(parsed.data);
    response.status(201).json(promo);
  } catch (error) {
    next(error);
  }
};

export const listPromotionsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listPromotionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const promos = await listPromotions({
      status: parsed.data.status,
      productId: parsed.data.productId
    });
    response.status(200).json(promos);
  } catch (error) {
    next(error);
  }
};

/** Currently-eligible promos (status active, not expired, stock available) — used by order creation preview. */
export const listActivePromotionsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listActivePromotionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const promos = await listActivePromotions({
      productId: parsed.data.productId,
      unit: parsed.data.unit
    });
    response.status(200).json(promos);
  } catch (error) {
    next(error);
  }
};

export const getPromotionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const promo = await getPromotionById(id);
    response.status(200).json(promo);
  } catch (error) {
    next(error);
  }
};

export const updatePromotionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updatePromotionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const promo = await updatePromotion(id, parsed.data);
    response.status(200).json(promo);
  } catch (error) {
    next(error);
  }
};

export const updatePromotionStatusHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updatePromotionStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const promo = await setPromotionStatus(id, parsed.data.status);
    response.status(200).json(promo);
  } catch (error) {
    next(error);
  }
};

export const deletePromotionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deletePromotion(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};