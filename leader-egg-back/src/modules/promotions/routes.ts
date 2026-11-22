import { Router } from 'express';
import {
  createPromotionHandler,
  listPromotionsHandler,
  listActivePromotionsHandler,
  getPromotionHandler,
  updatePromotionHandler,
  updatePromotionStatusHandler,
  deletePromotionHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const promotionRouter = Router();

// All promotion routes require authentication
promotionRouter.use(authenticate);

// Read — admin list (management view incl. inactive) ; active list is the
// order-creation preview and is open to any authenticated role.
promotionRouter.get('/', authorize('admin'), requirePermission('promotions.view'), listPromotionsHandler);
// Static route MUST be registered before /:id
promotionRouter.get('/active', listActivePromotionsHandler);
promotionRouter.get('/:id', authorize('admin'), requirePermission('promotions.view'), getPromotionHandler);

// Write operations — admin only
promotionRouter.post('/', authorize('admin'), requirePermission('promotions.manage'), createPromotionHandler);
promotionRouter.put('/:id', authorize('admin'), requirePermission('promotions.manage'), updatePromotionHandler);
promotionRouter.patch('/:id/status', authorize('admin'), requirePermission('promotions.manage'), updatePromotionStatusHandler);
promotionRouter.delete('/:id', authorize('admin'), requirePermission('promotions.manage'), deletePromotionHandler);