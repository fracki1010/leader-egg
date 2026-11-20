import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { recordPayment, listPaymentsByOrder, generateReceipt } from './service.js';
import { createPaymentSchema } from './schema.js';

export const recordPaymentHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createPaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const orderId = request.params.id as string;
    const payment = await recordPayment(orderId, parsed.data);
    response.status(201).json(payment);
  } catch (error) {
    next(error);
  }
};

export const listPaymentsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const orderId = request.params.id as string;
    const payments = await listPaymentsByOrder(orderId);
    response.status(200).json(payments);
  } catch (error) {
    next(error);
  }
};

export const getReceiptHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const orderId = request.params.id as string;
    const receipt = await generateReceipt(orderId);
    response.status(200).json(receipt);
  } catch (error) {
    next(error);
  }
};
