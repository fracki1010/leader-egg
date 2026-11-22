import { Router } from 'express';
import {
  previewCloseHandler,
  createCloseHandler,
  updateCloseHandler,
  getCloseByDateHandler,
  listClosesHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const dailyCloseRouter = Router();

// All daily-close routes require authentication. Stall (puesto) users may
// preview/create/list closes but only for their own channel (enforced in the
// service); PATCH stays admin-only (design D7).
dailyCloseRouter.use(authenticate);
dailyCloseRouter.use(authorize('admin', 'puesto'));

// Route order matters: '/preview' must be declared before '/:date'.
dailyCloseRouter.get('/preview', requirePermission('cash.view'), previewCloseHandler);
dailyCloseRouter.post('/', requirePermission('cash.manage'), createCloseHandler);
dailyCloseRouter.patch('/:id', authorize('admin'), requirePermission('cash.manage'), updateCloseHandler);
dailyCloseRouter.get('/', requirePermission('cash.view'), listClosesHandler);
dailyCloseRouter.get('/:date', requirePermission('cash.view'), getCloseByDateHandler);
