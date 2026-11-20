import { Router } from 'express';
import {
  createOrderHandler,
  listOrdersHandler,
  getOrderHandler,
  transitionOrderHandler,
  driverTransitionOrderHandler,
  getCustomerOutstandingHandler,
  getTodayOrdersHandler,
  updateOrderHandler,
  deleteOrderHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const orderRouter = Router();

// All order routes require authentication
orderRouter.use(authenticate);

// Read operations — admin and driver can read
// Static routes must be registered before /:id
orderRouter.get('/', requirePermission('orders.view'), listOrdersHandler);
orderRouter.get('/overdue', requirePermission('orders.view'), listOrdersHandler);
orderRouter.get('/today', requirePermission('orders.view'), getTodayOrdersHandler);
orderRouter.get('/customers/:id/outstanding', requirePermission('orders.view'), getCustomerOutstandingHandler);
orderRouter.get('/:id', requirePermission('orders.view'), getOrderHandler);

// Write operations — admin only, except stall (puesto) order creation.
orderRouter.post('/', authorize('admin', 'puesto'), requirePermission('orders.manage'), createOrderHandler);
orderRouter.patch('/:id', authorize('admin'), requirePermission('orders.manage'), updateOrderHandler);
orderRouter.patch('/:id/status', authorize('admin'), requirePermission('orders.manage'), transitionOrderHandler);
orderRouter.delete('/:id', authorize('admin'), requirePermission('orders.manage'), deleteOrderHandler);

// Driver order transition (limited to in_transit only)
orderRouter.patch(
  '/:id/driver-transition',
  authorize('driver'),
  requirePermission('orders.manage'),
  driverTransitionOrderHandler
);
