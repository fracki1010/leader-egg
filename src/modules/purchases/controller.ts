import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createPurchase,
  listPurchases,
  getPurchaseById,
  updatePurchase,
  deliverPurchase,
  cancelPurchase,
  recordPayment,
  deletePurchase
} from './service.js';
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  recordPaymentSchema,
  listPurchasesQuerySchema
} from './schema.js';

/** Parses with zod; on failure forwards a 400 AppError and returns null. */
const parseBody = <T>(result: { success: boolean; data?: T; error?: { issues: Array<{ message: string }> } }, next: NextFunction): T | null => {
  if (!result.success) {
    next(new AppError(result.error!.issues.map(i => i.message).join('; '), 400));
    return null;
  }
  return result.data as T;
};

export const createPurchaseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const data = parseBody(createPurchaseSchema.safeParse(request.body), next);
    if (!data) return;

    const purchase = await createPurchase(data, request.user?.userId ?? 'system');
    response.status(201).json(purchase);
  } catch (error) {
    next(error);
  }
};

export const listPurchasesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const data = parseBody(listPurchasesQuerySchema.safeParse(request.query), next);
    if (!data) return;

    const purchases = await listPurchases({
      supplierId: data.supplierId,
      from: data.from,
      to: data.to,
      status: data.status
    });
    response.status(200).json(purchases);
  } catch (error) {
    next(error);
  }
};

export const getPurchaseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const detail = await getPurchaseById(id);
    response.status(200).json(detail);
  } catch (error) {
    next(error);
  }
};

export const updatePurchaseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const data = parseBody(updatePurchaseSchema.safeParse(request.body), next);
    if (!data) return;

    const purchase = await updatePurchase(id, data);
    response.status(200).json(purchase);
  } catch (error) {
    next(error);
  }
};

export const deliverPurchaseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const purchase = await deliverPurchase(id, request.user?.userId ?? 'system');
    response.status(200).json(purchase);
  } catch (error) {
    next(error);
  }
};

export const cancelPurchaseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const purchase = await cancelPurchase(id);
    response.status(200).json(purchase);
  } catch (error) {
    next(error);
  }
};

export const recordPaymentHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const data = parseBody(recordPaymentSchema.safeParse(request.body), next);
    if (!data) return;

    const purchase = await recordPayment(id, data);
    response.status(200).json(purchase);
  } catch (error) {
    next(error);
  }
};

export const deletePurchaseHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deletePurchase(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};