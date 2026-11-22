import { Router } from 'express';
import { getAlertsHandler, getDashboardSummaryHandler } from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const dashboardRouter = Router();

// All dashboard routes require authentication
dashboardRouter.use(authenticate);

// Alerts are admin-only
dashboardRouter.get('/alerts', authorize('admin'), requirePermission('reports.view'), getAlertsHandler);

// Consolidated summary — visible to admin and driver (the dashboard is the hero screen)
// Aggregated reporting data, so admins need `reports.view`; drivers bypass.
dashboardRouter.get(
  '/summary',
  authorize('admin', 'driver'),
  requirePermission('reports.view'),
  getDashboardSummaryHandler
);