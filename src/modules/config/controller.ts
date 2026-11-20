import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { getBusinessProfile, getPuntoCero, setPuntoCero, updateBusinessProfile, updateOpeningBalances } from './service.js';
import { setPuntoCeroSchema, updateBusinessProfileSchema, updateOpeningBalancesSchema } from './schema.js';

export const getPuntoCeroHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const state = await getPuntoCero();
    response.status(200).json(state);
  } catch (error) {
    next(error);
  }
};

export const setPuntoCeroHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = setPuntoCeroSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const state = await setPuntoCero(parsed.data, request.user?.userId ?? 'system');
    response.status(200).json(state);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /v1/setup/opening-balances — repairs the initial per-account opening
 * balances. Admin-only (router guard). This is a configuration correction, not
 * a movement; day-to-day money fixes go through the append-only
 * `/v1/cash-adjustments` ledger. Returns the refreshed punto-cero state so the
 * client gets the new values in one round trip.
 */
export const updateOpeningBalancesHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = updateOpeningBalancesSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const state = await updateOpeningBalances(parsed.data);
    response.status(200).json(state);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /v1/setup/profile — the tenant's business identity (name, address,
 * phone). Admin-only via the router guard; returns empty strings until the
 * tenant fills the profile in.
 */
export const getBusinessProfileHandler = async (
  _request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const profile = await getBusinessProfile();
    response.status(200).json(profile);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /v1/setup/profile — partial update of the business identity. An empty
 * body is rejected with 400 by the schema. Returns the refreshed profile.
 */
export const updateBusinessProfileHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = updateBusinessProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const profile = await updateBusinessProfile(parsed.data);
    response.status(200).json(profile);
  } catch (error) {
    next(error);
  }
};