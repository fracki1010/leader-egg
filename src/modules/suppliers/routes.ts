import { Router } from 'express';
import {
  createSupplierHandler,
  listSuppliersHandler,
  getSupplierHandler,
  updateSupplierHandler,
  updateSupplierStatusHandler,
  deleteSupplierHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const supplierRouter = Router();

// All supplier routes require authentication
supplierRouter.use(authenticate);

// Read operations — any authenticated role can read suppliers (stock module).
supplierRouter.get('/', requirePermission('stock.view'), listSuppliersHandler);
supplierRouter.get('/:id', requirePermission('stock.view'), getSupplierHandler);

// Write operations — admin only
supplierRouter.post('/', authorize('admin'), requirePermission('stock.manage'), createSupplierHandler);
supplierRouter.put('/:id', authorize('admin'), requirePermission('stock.manage'), updateSupplierHandler);
supplierRouter.patch('/:id/status', authorize('admin'), requirePermission('stock.manage'), updateSupplierStatusHandler);
supplierRouter.delete('/:id', authorize('admin'), requirePermission('stock.manage'), deleteSupplierHandler);