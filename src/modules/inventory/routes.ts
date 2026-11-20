import { Router } from 'express';
import {
  getInventoryHandler,
  getInventoryByProductHandler,
  adjustStockHandler,
  getTransactionsHandler,
  createInventoryHandler,
  deleteInventoryHandler,
  incrementStockHandler,
  decrementStockHandler,
  classifyHandler,
  listTransactionsHandler,
  updateThresholdHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const inventoryRouter = Router();

// All inventory routes require authentication
inventoryRouter.use(authenticate);

// Read routes
inventoryRouter.get('/', requirePermission('stock.view'), getInventoryHandler);
// Static route must be declared before '/:productId' so 'transactions' is not captured as a product id
inventoryRouter.get('/transactions', authorize('admin'), requirePermission('stock.view'), listTransactionsHandler);
inventoryRouter.get('/:productId/transactions', requirePermission('stock.view'), getTransactionsHandler);
inventoryRouter.get('/:productId', requirePermission('stock.view'), getInventoryByProductHandler);

// Write routes (admin only)
inventoryRouter.post('/', authorize('admin'), requirePermission('stock.manage'), createInventoryHandler);
inventoryRouter.delete('/:productId', authorize('admin'), requirePermission('stock.manage'), deleteInventoryHandler);
inventoryRouter.post('/:productId/increment', authorize('admin'), requirePermission('stock.manage'), incrementStockHandler);
inventoryRouter.post('/:productId/decrement', authorize('admin'), requirePermission('stock.manage'), decrementStockHandler);
// Classify is a subresource of /:productId — no generic POST /:productId
// route exists, so it cannot be shadowed regardless of declaration order.
inventoryRouter.post('/:productId/classify', authorize('admin'), requirePermission('stock.manage'), classifyHandler);
inventoryRouter.patch('/:productId/threshold', authorize('admin'), requirePermission('stock.manage'), updateThresholdHandler);
inventoryRouter.patch('/:productId', authorize('admin'), requirePermission('stock.manage'), adjustStockHandler);

// Append-only: transactions cannot be updated or deleted
const methodNotAllowed = (_req: never, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
  res.status(405).json({ error: 'Method Not Allowed' });
};

inventoryRouter.put('/:productId/transactions', methodNotAllowed as never);
inventoryRouter.patch('/:productId/transactions', methodNotAllowed as never);
inventoryRouter.delete('/:productId/transactions', methodNotAllowed as never);