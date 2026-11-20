import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createSupplier,
  listSuppliers,
  getSupplierById,
  updateSupplier,
  deactivateSupplier,
  activateSupplier,
  deleteSupplier
} from './service.js';
import {
  createSupplierSchema,
  updateSupplierSchema,
  updateStatusSchema,
  listSuppliersQuerySchema
} from './schema.js';

export const createSupplierHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createSupplierSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const supplier = await createSupplier(parsed.data);
    response.status(201).json(supplier);
  } catch (error) {
    next(error);
  }
};

export const listSuppliersHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listSuppliersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const suppliers = await listSuppliers({
      includeInactive: parsed.data.includeInactive === 'true'
    });
    response.status(200).json(suppliers);
  } catch (error) {
    next(error);
  }
};

export const getSupplierHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const supplier = await getSupplierById(id);
    response.status(200).json(supplier);
  } catch (error) {
    next(error);
  }
};

export const updateSupplierHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateSupplierSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const supplier = await updateSupplier(id, parsed.data);
    response.status(200).json(supplier);
  } catch (error) {
    next(error);
  }
};

export const updateSupplierStatusHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const supplier = parsed.data.status === 'inactive'
      ? await deactivateSupplier(id)
      : await activateSupplier(id);

    response.status(200).json(supplier);
  } catch (error) {
    next(error);
  }
};

export const deleteSupplierHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    await deleteSupplier(id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};