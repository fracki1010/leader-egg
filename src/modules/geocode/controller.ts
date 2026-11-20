import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { geocodeAddress, reverseGeocode } from './service.js';
import { geocodeRequestSchema, reverseGeocodeSchema } from './schema.js';

export const geocodeHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = geocodeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const result = await geocodeAddress(parsed.data.address);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const reverseGeocodeHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reverseGeocodeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const result = await reverseGeocode(parsed.data.lat, parsed.data.lng);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};