import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createVehicle,
  listVehicles,
  getVehicleDetail,
  updateVehicle,
  setVehicleStatus
} from './service.js';
import {
  createVehicleSchema,
  updateVehicleSchema,
  updateStatusSchema,
  listVehiclesQuerySchema
} from './schema.js';

export const createVehicleHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createVehicleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const vehicle = await createVehicle(parsed.data);
    response.status(201).json(vehicle);
  } catch (error) {
    next(error);
  }
};

export const listVehiclesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listVehiclesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const vehicles = await listVehicles({
      includeInactive: parsed.data.includeInactive === 'true'
    });
    response.status(200).json(vehicles);
  } catch (error) {
    next(error);
  }
};

// GET /:id returns the aggregated detail (costs, delivery stats, recent routes).
export const getVehicleHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const detail = await getVehicleDetail(id);
    response.status(200).json(detail);
  } catch (error) {
    next(error);
  }
};

export const updateVehicleHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateVehicleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const vehicle = await updateVehicle(id, parsed.data);
    response.status(200).json(vehicle);
  } catch (error) {
    next(error);
  }
};

export const updateVehicleStatusHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = updateStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const vehicle = parsed.data.status === 'inactive'
      ? await setVehicleStatus(id, false)
      : await setVehicleStatus(id, true);

    response.status(200).json(vehicle);
  } catch (error) {
    next(error);
  }
};