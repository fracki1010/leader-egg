import { Router } from 'express';
import {
  createPurchaseHandler,
  listPurchasesHandler,
  getPurchaseHandler,
  updatePurchaseHandler,
  deliverPurchaseHandler,
  cancelPurchaseHandler,
  recordPaymentHandler,
  deletePurchaseHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const purchaseRouter = Router();

// Purchases are admin-only: delivering one mutates stock and product costs.
purchaseRouter.use(authenticate, authorize('admin'));

purchaseRouter.get('/', requirePermission('purchases.view'), listPurchasesHandler);
purchaseRouter.get('/:id', requirePermission('purchases.view'), getPurchaseHandler);
purchaseRouter.post('/', requirePermission('purchases.manage'), createPurchaseHandler);
purchaseRouter.patch('/:id', requirePermission('purchases.manage'), updatePurchaseHandler);
purchaseRouter.patch('/:id/deliver', requirePermission('purchases.manage'), deliverPurchaseHandler);
purchaseRouter.patch('/:id/cancel', requirePermission('purchases.manage'), cancelPurchaseHandler);
purchaseRouter.patch('/:id/payment', requirePermission('purchases.manage'), recordPaymentHandler);
purchaseRouter.delete('/:id', requirePermission('purchases.manage'), deletePurchaseHandler);