import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env.js';

export class AppError extends Error {
  public readonly status: number;
  public readonly isOperational: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class CreditLimitExceededError extends AppError {
  public readonly outstandingBalance: number;
  public readonly newOrderTotal: number;
  public readonly creditLimit: number;
  public readonly overage: number;

  constructor(outstandingBalance: number, newOrderTotal: number, creditLimit: number, overage: number) {
    super('Credit limit exceeded', 409);
    this.outstandingBalance = outstandingBalance;
    this.newOrderTotal = newOrderTotal;
    this.creditLimit = creditLimit;
    this.overage = overage;
    Object.setPrototypeOf(this, CreditLimitExceededError.prototype);
  }
}

/**
 * Raised when an order/purchase identical to a recent one is submitted.
 * The payload carries the existing record so the client can offer
 * "view existing" or an explicit force-create.
 */
export class DuplicateRecordError extends AppError {
  public readonly resource: 'order' | 'purchase';
  public readonly existingId: string;
  public readonly existingNumber: string;
  public readonly existingCreatedAt: Date;

  constructor(
    message: string,
    resource: 'order' | 'purchase',
    existingId: string,
    existingNumber: string,
    existingCreatedAt: Date
  ) {
    super(message, 409);
    this.resource = resource;
    this.existingId = existingId;
    this.existingNumber = existingNumber;
    this.existingCreatedAt = existingCreatedAt;
    Object.setPrototypeOf(this, DuplicateRecordError.prototype);
  }
}

export class InsufficientStockError extends AppError {
  public readonly productId: string;
  public readonly required: number;
  public readonly available: number;

  constructor(productId: string, required: number, available: number) {
    super('Insufficient stock', 409);
    this.productId = productId;
    this.required = required;
    this.available = available;
    Object.setPrototypeOf(this, InsufficientStockError.prototype);
  }
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'Route not found' });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof CreditLimitExceededError) {
    response.status(error.status).json({
      error: error.message,
      outstandingBalance: error.outstandingBalance,
      newOrderTotal: error.newOrderTotal,
      creditLimit: error.creditLimit,
      overage: error.overage
    });
    return;
  }

  if (error instanceof DuplicateRecordError) {
    response.status(error.status).json({
      error: error.message,
      code: 'DUPLICATE_RECORD',
      resource: error.resource,
      existingId: error.existingId,
      existingNumber: error.existingNumber,
      existingCreatedAt: error.existingCreatedAt.toISOString()
    });
    return;
  }

  if (error instanceof InsufficientStockError) {
    response.status(error.status).json({
      error: error.message,
      productId: error.productId,
      required: error.required,
      available: error.available
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  const status = typeof error?.status === 'number' && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  const message = env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : error instanceof Error ? error.message : 'Internal server error';

  response.status(status).json({ error: message });
};
