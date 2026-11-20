import { Router } from 'express';
import {
  createRouteHandler,
  listRoutesHandler,
  getRouteHandler,
  addStopHandler,
  removeStopHandler,
  reorderStopsHandler,
  optimizeRouteHandler,
  startRouteHandler,
  completeRouteHandler,
  cancelRouteHandler,
  advanceStopHandler,
  addStopNoteHandler,
  getDriverActiveRouteHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from '../auth/middleware.js';

export const routeRouter = Router();

// All route operations require authentication
routeRouter.use(authenticate);

// ─── Driver-specific routes (must be before /:id to avoid param capture) ────
routeRouter.get('/driver/active', authorize('driver'), getDriverActiveRouteHandler);

// ─── Read operations — admin and driver ──────────────────────────────────────
routeRouter.get('/', requirePermission('routes.view'), listRoutesHandler);
routeRouter.get('/:id', requirePermission('routes.view'), getRouteHandler);

// ─── Admin-only operations ───────────────────────────────────────────────────
routeRouter.post('/', authorize('admin'), requirePermission('routes.manage'), createRouteHandler);
routeRouter.post('/:id/stops', authorize('admin'), requirePermission('routes.manage'), addStopHandler);
routeRouter.delete('/:id/stops/:stopId', authorize('admin'), requirePermission('routes.manage'), removeStopHandler);
routeRouter.patch('/:id/stops/reorder', authorize('admin'), requirePermission('routes.manage'), reorderStopsHandler);
routeRouter.post('/:id/optimize', authorize('admin'), requirePermission('routes.manage'), optimizeRouteHandler);
routeRouter.patch('/:id/start', authorize('admin'), requirePermission('routes.manage'), startRouteHandler);
routeRouter.patch('/:id/complete', authorize('admin'), requirePermission('routes.manage'), completeRouteHandler);
routeRouter.patch('/:id/cancel', authorize('admin'), requirePermission('routes.manage'), cancelRouteHandler);

// ─── Driver + Admin operations ───────────────────────────────────────────────
routeRouter.patch(
  '/:id/stops/:stopId/advance',
  authorize('admin', 'driver'),
  requirePermission('routes.manage'),
  advanceStopHandler
);
routeRouter.patch(
  '/:id/stops/:stopId/notes',
  authorize('admin', 'driver'),
  requirePermission('routes.manage'),
  addStopNoteHandler
);
