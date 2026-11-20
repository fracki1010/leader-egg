import { Router } from 'express';
import { listMovementsHandler, getSummaryHandler } from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

/**
 * Unified Caja endpoints — admin-only.
 *
 * The Caja screen shows every money movement across all accounts plus the
 * per-account position, so both reads are restricted to `admin` (superadmin
 * inherits admin). There are no write routes here: money is created by the
 * existing payments / expenses / adjustments / purchases / returns modules.
 */
export const cashRouter = Router();

cashRouter.use(authenticate);
cashRouter.use(authorize('admin'));

cashRouter.get('/movements', requirePermission('cash.view'), listMovementsHandler);
cashRouter.get('/summary', requirePermission('cash.view'), getSummaryHandler);
