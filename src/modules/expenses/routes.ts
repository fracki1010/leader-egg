import { Router } from 'express';
import {
  createExpenseHandler,
  listExpensesHandler,
  getTotalsHandler,
  deleteExpenseHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const expenseRouter = Router();

// All expense routes require admin authentication
expenseRouter.use(authenticate);
expenseRouter.use(authorize('admin'));

expenseRouter.post('/', requirePermission('cash.manage'), createExpenseHandler);
expenseRouter.get('/totals', requirePermission('cash.view'), getTotalsHandler);
expenseRouter.get('/', requirePermission('cash.view'), listExpensesHandler);
expenseRouter.delete('/:id', requirePermission('cash.manage'), deleteExpenseHandler);
