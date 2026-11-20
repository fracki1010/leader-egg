import { Router } from 'express';
import {
  createCustomerChargeHandler,
  listCustomerChargesHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

/**
 * Manual customer charges (cuenta corriente / fiado) — admin-only.
 *
 * Nested under customers: /v1/customers/:id/charges (mergeParams so `:id`
 * is read from the parent mount). Both the financial write and the history
 * (which exposes operator ids) stay out of the driver/viewer/puesto surface.
 * There is NO update/delete route: the ledger is append-only by design
 * (see model.ts) — corrections are registered as opposite entries.
 */
export const customerChargeRouter = Router({ mergeParams: true });

customerChargeRouter.use(authenticate);
customerChargeRouter.use(authorize('admin'));

customerChargeRouter.post('/', requirePermission('customers.manage'), createCustomerChargeHandler);
customerChargeRouter.get('/', requirePermission('customers.view'), listCustomerChargesHandler);
