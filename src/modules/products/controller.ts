import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  listPricesByProduct,
  createPriceEntry,
  getActivePrice
} from './service.js';
import { createProductSchema, createPriceEntrySchema, updateProductSchema, listProductsQuerySchema } from './schema.js';
import {
  CALIBERS,
  VARIETIES,
  VARIETY_LABELS,
  CALIBER_LABELS,
  displayName,
  type ProductCaliber,
  type ProductVariety
} from './model.js';
import { PRODUCT_UNIT_ENUM, type ProductUnit } from './units.js';

export const listProductsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listProductsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }
    const products = await listProducts(parsed.data);
    response.status(200).json(products);
  } catch (error) {
    next(error);
  }
};

export const getProductHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const product = await getProductById(id);
    response.status(200).json(product);
  } catch (error) {
    next(error);
  }
};

export const createProductHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const product = await createProduct(parsed.data);
    response.status(201).json(product);
  } catch (error) {
    next(error);
  }
};

export const updateProductHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateProductSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const product = await updateProduct(id, parsed.data);
    response.status(200).json(product);
  } catch (error) {
    next(error);
  }
};

export const listPricesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const prices = await listPricesByProduct(id);
    response.status(200).json(prices);
  } catch (error) {
    next(error);
  }
};

export const createPriceHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createPriceEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const entry = await createPriceEntry(id, parsed.data);
    response.status(201).json(entry);
  } catch (error) {
    next(error);
  }
};

export const getActivePriceHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const dateParam = request.query.date;
    const date = dateParam ? new Date(dateParam as string) : new Date();

    if (isNaN(date.getTime())) {
      throw new AppError('Invalid date parameter', 400);
    }

    const unitParam = request.query.unit as string | undefined;
    if (unitParam !== undefined && !PRODUCT_UNIT_ENUM.includes(unitParam as ProductUnit)) {
      throw new AppError(
        'Invalid unit parameter (must be "maple", "medio_cajon" or "cajon")',
        400
      );
    }
    const unit = (unitParam ?? 'maple') as ProductUnit;

    const id = request.params.id as string;
    const entry = await getActivePrice(id, unit, date);
    response.status(200).json(entry);
  } catch (error) {
    next(error);
  }
};

export const deleteProductHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deleteProduct(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

/** GET /products/options — variety×caliber catalog with labels for the create form. */
export const optionsHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const varieties = VARIETIES.map((value) => ({ value, label: VARIETY_LABELS[value] }));
    const calibers = CALIBERS.map((value) => ({ value, label: CALIBER_LABELS[value] }));
    const combos = VARIETIES.flatMap((variety) =>
      CALIBERS.map((caliber) => ({ variety, caliber, displayName: displayName({ variety, caliber }) }))
    );
    response.status(200).json({ varieties, calibers, combos });
  } catch (error) {
    next(error);
  }
};

/** GET /products/varieties — legacy shape (plain value arrays); prefer /options. */
export const varietiesHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const varieties: ProductVariety[] = VARIETIES;
    const calibers: ProductCaliber[] = CALIBERS;
    response.status(200).json({ varieties, calibers });
  } catch (error) {
    next(error);
  }
};
