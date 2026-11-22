import { Router } from 'express';
import { listAccountsHandler, getAccountMovementsHandler } from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const accountRouter = Router();

// Accounts are a superadmin-only view of customer credit — no driver access.
accountRouter.use(authenticate);
accountRouter.use(authorize('admin'));

accountRouter.get('/', requirePermission('accounts.view'), listAccountsHandler);
accountRouter.get('/:customerId/movements', requirePermission('accounts.view'), getAccountMovementsHandler);