import { Types } from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import type { ITransaction } from './transaction-model.js';
import {
  getInventory,
  getInventoryByProduct,
  adjustStock,
  getTransactions,
  incrementStock,
  decrementStockManual,
  createInventoryForProduct,
  deleteInventoryRecord,
  updateLowStockThreshold,
  listAllTransactions,
  classifyInventory,
  type ClassifyTarget,
  type TransactionListFilters
} from './service.js';

export const getInventoryHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const inventory = await getInventory();
    response.status(200).json(inventory);
  } catch (error) {
    next(error);
  }
};

export const getInventoryByProductHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    const record = await getInventoryByProduct(productId);
    response.status(200).json(record);
  } catch (error) {
    next(error);
  }
};

export const adjustStockHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    const { quantity, notes } = request.body as { quantity?: number; notes?: string };

    if (quantity === undefined || typeof quantity !== 'number' || quantity < 0) {
      throw new AppError('Quantity must be a non-negative number', 400);
    }

    const userId = request.user?.userId ?? 'system';
    const record = await adjustStock(productId, quantity, notes ?? '', userId);
    response.status(200).json(record);
  } catch (error) {
    next(error);
  }
};

export const getTransactionsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    const transactions = await getTransactions(productId);
    response.status(200).json(transactions);
  } catch (error) {
    next(error);
  }
};

export const createInventoryHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const { productId, quantity, lowStockThreshold } = request.body as {
      productId?: string;
      quantity?: number;
      lowStockThreshold?: number;
    };

    if (typeof productId !== 'string' || !Types.ObjectId.isValid(productId)) {
      throw new AppError('productId is required and must be a valid ObjectId', 400);
    }
    if (quantity !== undefined && (typeof quantity !== 'number' || quantity < 0)) {
      throw new AppError('quantity must be a non-negative number', 400);
    }
    if (lowStockThreshold !== undefined && (typeof lowStockThreshold !== 'number' || lowStockThreshold <= 0)) {
      throw new AppError('lowStockThreshold must be a positive number', 400);
    }

    const userId = request.user?.userId ?? 'system';
    const record = await createInventoryForProduct(productId, quantity ?? 0, lowStockThreshold, userId);
    response.status(201).json(record);
  } catch (error) {
    next(error);
  }
};

export const deleteInventoryHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    await deleteInventoryRecord(productId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const incrementStockHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    const { quantity, notes } = request.body as { quantity?: number; notes?: string };

    if (typeof quantity !== 'number' || quantity <= 0) {
      throw new AppError('quantity must be a positive number', 400);
    }

    const userId = request.user?.userId ?? 'system';
    const record = await incrementStock(productId, quantity, notes ?? '', userId);
    response.status(200).json(record);
  } catch (error) {
    next(error);
  }
};

export const decrementStockHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    const { quantity, notes } = request.body as { quantity?: number; notes?: string };

    if (typeof quantity !== 'number' || quantity <= 0) {
      throw new AppError('quantity must be a positive number', 400);
    }

    const userId = request.user?.userId ?? 'system';
    const record = await decrementStockManual(productId, quantity, notes ?? '', userId);
    response.status(200).json(record);
  } catch (error) {
    next(error);
  }
};

export const classifyHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const fromProductId = request.params.productId as string;
    const { to, notes } = request.body as { to?: ClassifyTarget[]; notes?: string };

    if (!Array.isArray(to) || to.length === 0) {
      throw new AppError('to must be a non-empty array', 400);
    }
    for (const entry of to) {
      if (
        typeof entry?.productId !== 'string' ||
        typeof entry?.quantity !== 'number' ||
        !Number.isFinite(entry.quantity) ||
        entry.quantity <= 0
      ) {
        throw new AppError('Each target needs a productId and a quantity greater than 0', 400);
      }
    }

    const userId = request.user?.userId ?? 'system';
    const result = await classifyInventory(fromProductId, to, notes, userId);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const TRANSACTION_TYPES = ['sale', 'purchase', 'adjustment', 'delivery'] as const;

export const listTransactionsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const filters = parseTransactionFilters(request.query);
    const result = await listAllTransactions(filters);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const parseTransactionFilters = (query: Request['query']): TransactionListFilters => {
  const productId = query.productId as string | undefined;
  const type = query.type as string | undefined;
  const fromRaw = query.from as string | undefined;
  const toRaw = query.to as string | undefined;

  if (productId !== undefined && !Types.ObjectId.isValid(productId)) {
    throw new AppError('Invalid productId', 400);
  }
  if (type !== undefined && !(TRANSACTION_TYPES as readonly string[]).includes(type)) {
    throw new AppError('Invalid transaction type', 400);
  }

  let from: Date | undefined;
  let to: Date | undefined;
  if (fromRaw !== undefined) {
    from = new Date(fromRaw);
    if (isNaN(from.getTime())) {
      throw new AppError('Invalid from date', 400);
    }
  }
  if (toRaw !== undefined) {
    to = new Date(toRaw);
    if (isNaN(to.getTime())) {
      throw new AppError('Invalid to date', 400);
    }
  }

  let limit = 50;
  let page = 1;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new AppError('limit must be a positive integer', 400);
    }
    limit = Math.min(limit, 200);
  }
  if (query.page !== undefined) {
    page = Number(query.page);
    if (!Number.isInteger(page) || page <= 0) {
      throw new AppError('page must be a positive integer', 400);
    }
  }

  return {
    productId,
    type: type as ITransaction['type'] | undefined,
    from,
    to,
    limit,
    page
  };
};

export const updateThresholdHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = request.params.productId as string;
    const { lowStockThreshold } = request.body as { lowStockThreshold?: number };

    if (typeof lowStockThreshold !== 'number' || lowStockThreshold <= 0) {
      throw new AppError('lowStockThreshold must be a positive number', 400);
    }

    const product = await updateLowStockThreshold(productId, lowStockThreshold);
    response.status(200).json(product);
  } catch (error) {
    next(error);
  }
};