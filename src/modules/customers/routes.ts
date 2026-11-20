import { Router } from 'express';
import {
  createCustomerHandler,
  listCustomersHandler,
  getCustomerHandler,
  getCustomerSummaryHandler,
  listCustomerOrdersHandler,
  updateCustomerHandler,
  updateCustomerStatusHandler,
  deleteCustomerHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const customerRouter = Router();

// All customer routes require authentication
customerRouter.use(authenticate);

// Read operations — admin and driver can read
// Subresource routes must be registered before /:id
customerRouter.get('/', requirePermission('customers.view'), listCustomersHandler);
customerRouter.get('/:id/orders', requirePermission('customers.view'), listCustomerOrdersHandler);
customerRouter.get('/:id/summary', requirePermission('customers.view'), getCustomerSummaryHandler);
customerRouter.get('/:id', requirePermission('customers.view'), getCustomerHandler);

// Write operations — admin only
customerRouter.post('/', authorize('admin'), requirePermission('customers.manage'), createCustomerHandler);
customerRouter.put('/:id', authorize('admin'), requirePermission('customers.manage'), updateCustomerHandler);
customerRouter.patch('/:id/status', authorize('admin'), requirePermission('customers.manage'), updateCustomerStatusHandler);
customerRouter.delete('/:id', authorize('admin'), requirePermission('customers.manage'), deleteCustomerHandler);