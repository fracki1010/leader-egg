import { Router } from 'express';
import {
  listProductsHandler,
  getProductHandler,
  createProductHandler,
  updateProductHandler,
  deleteProductHandler,
  listPricesHandler,
  createPriceHandler,
  getActivePriceHandler,
  optionsHandler,
  varietiesHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const productRouter = Router();

// All product routes require authentication
productRouter.use(authenticate);

// Product CRUD — products read as stock (inventory lives in the stock module).
productRouter.get('/', requirePermission('stock.view'), listProductsHandler);
productRouter.get('/options', requirePermission('stock.view'), optionsHandler);
productRouter.get('/varieties', requirePermission('stock.view'), varietiesHandler);
productRouter.get('/:id', requirePermission('stock.view'), getProductHandler);
productRouter.post('/', authorize('admin'), requirePermission('stock.manage'), createProductHandler);
productRouter.patch('/:id', authorize('admin'), requirePermission('stock.manage'), updateProductHandler);
productRouter.delete('/:id', authorize('admin'), requirePermission('stock.manage'), deleteProductHandler);

// Price list operations
productRouter.get('/:id/prices', requirePermission('stock.view'), listPricesHandler);
productRouter.get('/:id/prices/active', requirePermission('stock.view'), getActivePriceHandler);
productRouter.post('/:id/prices', authorize('admin'), requirePermission('stock.manage'), createPriceHandler);
