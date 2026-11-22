import { Router } from 'express';
import { createAdjustmentHandler, listAdjustmentsHandler } from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

/**
 * Manual cash adjustments — admin-only.
 *
 * Both writes and reads are restricted to `admin` (superadmin inherits admin).
 * The movement is financial and the history exposes operator names, so it stays
 * out of the driver/viewer/puesto surface; those roles never see the dashboard
 * "Ajustar caja" action either. There is no update/delete route: the ledger is
 * append-only by design (see model.ts).
 */
export const cashAdjustmentRouter = Router();

cashAdjustmentRouter.use(authenticate);
cashAdjustmentRouter.use(authorize('admin'));

cashAdjustmentRouter.post('/', requirePermission('cash.manage'), createAdjustmentHandler);
cashAdjustmentRouter.get('/', requirePermission('cash.view'), listAdjustmentsHandler);
