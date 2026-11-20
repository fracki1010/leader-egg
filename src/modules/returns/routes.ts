import { Router } from 'express';
import {
  createReturnHandler,
  listReturnsForOrderHandler,
  listReturnsHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

// Nested under orders: /v1/orders/:id/returns (same mergeParams pattern as payments).
export const returnsRouter = Router({ mergeParams: true });

// All returns routes require authentication.
returnsRouter.use(authenticate);

// Creating a return is a field action — admin or driver (design: admin + driver).
// Returns belong to the orders module; non-admin roles bypass the permission check.
returnsRouter.post('/returns', authorize('admin', 'driver'), requirePermission('orders.manage'), createReturnHandler);
returnsRouter.get('/returns', requirePermission('orders.view'), listReturnsForOrderHandler);

// Standalone admin listing: /v1/returns?customerId=&from=&to=&reason=
export const returnsListRouter = Router();
returnsListRouter.use(authenticate);
returnsListRouter.use(authorize('admin'));
returnsListRouter.get('/', requirePermission('orders.view'), listReturnsHandler);