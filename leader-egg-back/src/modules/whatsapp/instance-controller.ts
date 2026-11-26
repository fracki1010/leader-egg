import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { connectWhatsapp, getWhatsappConnection } from './instance-service.js';

/** Every route behind `authenticate` has a tenant; a token without one is refused. */
const tenantOf = (request: Request): string | null => request.user?.tenantId ?? null;

export const getConnectionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  const tenantId = tenantOf(request);
  if (!tenantId) return next(new AppError('Token is not bound to a tenant', 401));
  try {
    response.status(200).json(await getWhatsappConnection(tenantId));
  } catch (error) {
    next(error);
  }
};

export const connectHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  const tenantId = tenantOf(request);
  if (!tenantId) return next(new AppError('Token is not bound to a tenant', 401));
  try {
    response.status(200).json(await connectWhatsapp(tenantId));
  } catch (error) {
    next(error);
  }
};
