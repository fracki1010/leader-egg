import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  createRoute,
  listRoutes,
  getRouteById,
  addStopToRoute,
  removeStopFromRoute,
  reorderStops,
  optimizeRoute,
  startRoute,
  completeRoute,
  cancelRoute,
  advanceStop,
  addStopNote
} from './service.js';
import {
  createRouteSchema,
  addStopSchema,
  reorderStopsSchema,
  optimizeRouteSchema,
  advanceStopSchema,
  addStopNoteSchema,
  listRoutesQuerySchema,
  completeRouteSchema
} from './schema.js';

// POST / — admin creates a new route
export const createRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = createRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }
    const route = await createRoute(parsed.data);
    response.status(201).json(route);
  } catch (error) {
    next(error);
  }
};

// GET / — admin sees all, driver sees own
export const listRoutesHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listRoutesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const filter: Record<string, string | undefined> = {};
    if (parsed.data.status) filter.status = parsed.data.status;
    if (parsed.data.plannedDate) filter.plannedDate = parsed.data.plannedDate;

    // Drivers can only see their own routes
    if (request.user?.role === 'driver') {
      filter.driverId = request.user.userId;
    }

    const routes = await listRoutes(filter);
    response.status(200).json(routes);
  } catch (error) {
    next(error);
  }
};

// GET /driver/active — driver's active route (in_progress or today's planned)
export const getDriverActiveRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const driverId = request.user!.userId;
    const today = new Date().toISOString().slice(0, 10);

    // Look for in_progress route first, then today's planned
    const routes = await listRoutes({ driverId });
    const active = routes.find(r => r.status === 'in_progress')
      ?? routes.find(r => r.status === 'planned' && new Date(r.plannedDate).toISOString().slice(0, 10) === today);

    if (!active) {
      throw new AppError('No active route found', 404);
    }

    response.status(200).json(active);
  } catch (error) {
    next(error);
  }
};

// GET /:id — admin sees any, driver sees own only
export const getRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const id = request.params.id as string;
    const route = await getRouteById(id);

    // Drivers can only view their own routes
    if (request.user?.role === 'driver' && route.driverId.toString() !== request.user.userId) {
      throw new AppError('Insufficient permissions', 403);
    }

    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// POST /:id/stops — admin adds a stop
export const addStopHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = addStopSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const routeId = request.params.id as string;
    const route = await addStopToRoute(routeId, parsed.data.orderId);
    response.status(201).json(route);
  } catch (error) {
    next(error);
  }
};

// PATCH /:id/stops/reorder — admin reorders stops
export const reorderStopsHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = reorderStopsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const routeId = request.params.id as string;
    const route = await reorderStops(routeId, parsed.data.stopOrder);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// DELETE /:id/stops/:stopId — admin removes a pending stop
export const removeStopHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const routeId = request.params.id as string;
    const stopId = request.params.stopId as string;
    const route = await removeStopFromRoute(routeId, stopId);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// POST /:id/optimize — admin reorders stops by proximity (nearest-neighbor)
export const optimizeRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = optimizeRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const routeId = request.params.id as string;
    const route = await optimizeRoute(routeId, parsed.data);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// PATCH /:id/start — admin starts route
export const startRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const routeId = request.params.id as string;
    const route = await startRoute(routeId);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// PATCH /:id/complete — admin completes route (optionally with kmTravelled)
export const completeRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = completeRouteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const routeId = request.params.id as string;
    const route = await completeRoute(routeId, parsed.data);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// PATCH /:id/cancel — admin cancels route
export const cancelRouteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const routeId = request.params.id as string;
    const route = await cancelRoute(routeId);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// PATCH /:id/stops/:stopId/advance — admin or driver advances stop
export const advanceStopHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = advanceStopSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const routeId = request.params.id as string;
    const stopId = request.params.stopId as string;

    // Drivers must pass their ID for ownership validation
    const driverId = request.user?.role === 'driver' ? request.user.userId : undefined;

    const route = await advanceStop(routeId, stopId, { newStatus: parsed.data.status, notes: parsed.data.notes }, driverId);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};

// PATCH /:id/stops/:stopId/notes — driver adds notes to stop
export const addStopNoteHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = addStopNoteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const routeId = request.params.id as string;
    const stopId = request.params.stopId as string;
    const driverId = request.user?.role === 'driver' ? request.user.userId : undefined;

    const route = await addStopNote(routeId, stopId, parsed.data.notes, driverId);
    response.status(200).json(route);
  } catch (error) {
    next(error);
  }
};
