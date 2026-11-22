import { Router } from 'express';
import { recordCustomerPaymentHandler } from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

/**
 * Customer-level payments — admin-only.
 *
 * Nested under customers: /v1/customers/:id/payments (mergeParams so `:id`
 * is read from the parent mount). A single amount is auto-allocated to the
 * customer's open orders oldest-first (FIFO), which is a financial write, so
 * it stays out of the driver/viewer/puesto surface.
 */
export const customerPaymentRouter = Router({ mergeParams: true });

customerPaymentRouter.use(authenticate);
customerPaymentRouter.use(authorize('admin'));

customerPaymentRouter.post('/', requirePermission('customers.manage'), recordCustomerPaymentHandler);
