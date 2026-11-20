import { Router } from 'express';
import {
  getBusinessProfileHandler,
  getPuntoCeroHandler,
  setPuntoCeroHandler,
  updateBusinessProfileHandler,
  updateOpeningBalancesHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const configRouter = Router();

// Punto cero is a one-time critical setup — tenant admin only.
configRouter.use(authenticate);
configRouter.use(authorize('admin'));
configRouter.use(requirePermission('config.manage'));

configRouter.get('/punto-cero', getPuntoCeroHandler);
configRouter.post('/punto-cero', setPuntoCeroHandler);
// Explicit correction of the initial opening balances — allowed even after
// finalize (see service doc). Not a movement; use /v1/cash-adjustments for that.
configRouter.patch('/opening-balances', updateOpeningBalancesHandler);

// Business identity (name, address, phone). Same admin + config.manage guard.
configRouter.get('/profile', getBusinessProfileHandler);
configRouter.patch('/profile', updateBusinessProfileHandler);