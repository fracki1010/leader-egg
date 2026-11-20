import { Router } from 'express';
import {
  getAgingReportHandler,
  getRevenueReportHandler,
  getProfitReportHandler,
  getCustomerHistoryHandler,
  getCustomerFrequencyHandler,
  getTopCustomersHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const reportRouter = Router();

// All report routes require authentication + admin role
reportRouter.use(authenticate);
reportRouter.use(authorize('admin'));
reportRouter.use(requirePermission('reports.view'));

reportRouter.get('/aging', getAgingReportHandler);
reportRouter.get('/revenue', getRevenueReportHandler);
reportRouter.get('/profit', getProfitReportHandler);
reportRouter.get('/customers/top', getTopCustomersHandler);
reportRouter.get('/customers/:id/history', getCustomerHistoryHandler);
reportRouter.get('/customers/:id/frequency', getCustomerFrequencyHandler);
