import { AppError } from '../../middleware/error-handler.js';
import { toBusinessDate } from '../../utils/business-date.js';
import { Route, type IRoute, type RouteStatus, type StopStatus } from './model.js';
import { Order } from '../orders/model.js';
import { Customer } from '../customers/model.js';
import { User } from '../auth/model.js';
import { Vehicle } from '../vehicles/model.js';
import { toLatLng } from '../geocode/service.js';
import { getNextRouteNumber } from '../counters/model.js';
import {
  linkOrderToRoute,
  clearRouteFromOrder,
  transitionOrderStatus,
  deductStockForOrder
} from '../orders/service.js';

// ─── Route status machine ───────────────────────────────────────────────────

const VALID_ROUTE_TRANSITIONS: Record<RouteStatus, RouteStatus[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

const isValidRouteTransition = (from: RouteStatus, to: RouteStatus): boolean => {
  return VALID_ROUTE_TRANSITIONS[from].includes(to);
};

// ─── Stop status machine ────────────────────────────────────────────────────

const VALID_STOP_TRANSITIONS: Record<StopStatus, StopStatus[]> = {
  pending: ['in_transit', 'skipped'],
  in_transit: ['delivered', 'skipped'],
  delivered: [],
  skipped: []
};

const isValidStopTransition = (from: StopStatus, to: StopStatus): boolean => {
  return VALID_STOP_TRANSITIONS[from].includes(to);
};

// ─── Create Route ───────────────────────────────────────────────────────────

export interface CreateRouteInput {
  driverId: string;
  plannedDate: string;
  vehicleId?: string;
}

export const createRoute = async (input: CreateRouteInput): Promise<IRoute> => {
  const driver = await User.findById(input.driverId);
  if (!driver) {
    throw new AppError('Driver not found', 404);
  }
  if (driver.role !== 'driver') {
    throw new AppError('Selected user is not a driver', 400);
  }

  // Optional vehicle assignment — snapshot the name at creation so the route
  // keeps a stable reference even if the vehicle is renamed/deactivated later
  // (mirrors the driverName snapshot pattern).
  let vehicleId: IRoute['vehicleId'] = null;
  let vehicleName = '';
  if (input.vehicleId) {
    const vehicle = await Vehicle.findById(input.vehicleId);
    if (!vehicle) {
      throw new AppError('Vehicle not found', 404);
    }
    vehicleId = vehicle._id;
    vehicleName = vehicle.name;
  }

  const routeNumber = await getNextRouteNumber();

  const route = await Route.create({
    routeNumber,
    driverId: driver._id,
    driverName: driver.name,
    vehicleId,
    vehicleName,
    plannedDate: toBusinessDate(input.plannedDate) ?? new Date(input.plannedDate)
  });

  return route;
};

// ─── List Routes ────────────────────────────────────────────────────────────

export interface RouteFilter {
  status?: RouteStatus;
  driverId?: string;
  plannedDate?: string;
}

export const listRoutes = async (filter?: RouteFilter): Promise<IRoute[]> => {
  const query: Record<string, unknown> = {};

  if (filter?.status) {
    query.status = filter.status;
  }
  if (filter?.driverId) {
    query.driverId = filter.driverId;
  }
  if (filter?.plannedDate) {
    const start = new Date(filter.plannedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filter.plannedDate);
    end.setHours(23, 59, 59, 999);
    query.plannedDate = { $gte: start, $lte: end };
  }

  return Route.find(query).sort({ plannedDate: -1, createdAt: -1 });
};

// ─── Get Route By ID ────────────────────────────────────────────────────────

export const getRouteById = async (id: string): Promise<IRoute> => {
  const route = await Route.findById(id);
  if (!route) {
    throw new AppError('Route not found', 404);
  }
  return route;
};

// ─── Add Stop To Route ──────────────────────────────────────────────────────

export const addStopToRoute = async (routeId: string, orderId: string): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }
  if (route.status !== 'planned') {
    throw new AppError('Can only add stops to planned routes', 409);
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Check order not already on a route
  if (order.routeId) {
    throw new AppError('Order is already assigned to a route', 409);
  }

  // Validate order status: must be pending or assigned
  if (order.status !== 'pending' && order.status !== 'assigned') {
    throw new AppError('Order must be pending or assigned to be added to a route', 409);
  }

  // Snapshot customer data
  const customer = await Customer.findById(order.customerId);
  if (!customer) {
    throw new AppError('Customer not found for order', 404);
  }

  // Location snapshot (design D6): order.deliveryLocation ?? customer.location ?? undefined — no network
  const stopLocation = order.deliveryLocation ?? (customer.location ? toLatLng(customer.location) : undefined);

  // Calculate next sequence
  const maxSequence = route.stops.reduce((max, stop) => Math.max(max, stop.sequence), 0);
  const nextSequence = maxSequence + 1;

  // Add stop as subdocument
  const stop = route.stops.create({
    orderId: order._id,
    orderNumber: order.orderNumber,
    customerId: customer._id,
    customerName: customer.name,
    customerAddress: customer.address,
    customerPhone: customer.phone,
    sequence: nextSequence,
    status: 'pending',
    location: stopLocation,
    // Snapshot so the driver knows what to collect at the stop.
    paymentPreference: order.paymentPreference ?? 'cash',
    balanceToCollect: order.balance
  });
  route.stops.push(stop);
  await route.save();

  // Link order to route
  await linkOrderToRoute(order._id.toString(), routeId, stop._id.toString());

  // Auto-transition order to assigned if it was pending
  if (order.status === 'pending') {
    await transitionOrderStatus(order._id.toString(), 'assigned');
  }

  return Route.findById(routeId) as Promise<IRoute>;
};

// ─── Remove Stop From Route ─────────────────────────────────────────────────

export const removeStopFromRoute = async (routeId: string, stopId: string): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }
  if (route.status !== 'planned') {
    throw new AppError('Can only remove stops from planned routes', 409);
  }

  const stop = route.stops.id(stopId);
  if (!stop) {
    throw new AppError('Stop not found in route', 404);
  }
  if (stop.status !== 'pending') {
    throw new AppError('Can only remove pending stops', 409);
  }

  // Clear order route links
  await clearRouteFromOrder(stop.orderId.toString());

  // Remove stop
  stop.deleteOne();

  // Re-sequence remaining stops
  const sortedStops = [...route.stops].sort((a, b) => a.sequence - b.sequence);
  sortedStops.forEach((s, index) => {
    s.sequence = index + 1;
  });

  await route.save();
  return Route.findById(routeId) as Promise<IRoute>;
};

// ─── Route Optimization (nearest-neighbor) ──────────────────────────────────

export interface LatLngPoint {
  lat: number;
  lng: number;
}

/**
 * Haversine distance in meters between two lat/lng points.
 * Pure helper — exported for unit tests.
 */
export const haversineDistance = (a: LatLngPoint, b: LatLngPoint): number => {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
};

export interface NearestNeighborStop {
  _id: string;
  sequence: number;
  location?: LatLngPoint | null;
}

/**
 * Orders stops by proximity to `start` using the nearest-neighbor heuristic:
 * repeatedly pick the closest unvisited stop (haversine) to the current point,
 * then move the current point to that stop.
 *
 * - Stops WITH a `location` are visited first, starting from `start`.
 * - Stops WITHOUT a `location` keep their original relative order (by
 *   sequence) and are appended after the located ones.
 * - Pure and stable: does not mutate the input, returns ordered stop _ids.
 */
export const nearestNeighborOrder = (
  stops: NearestNeighborStop[],
  start: LatLngPoint
): string[] => {
  const located = stops
    .filter((s) => s.location)
    .sort((a, b) => a.sequence - b.sequence);
  const withoutLocation = stops
    .filter((s) => !s.location)
    .sort((a, b) => a.sequence - b.sequence);

  const ordered: string[] = [];
  const unvisited = [...located];
  let current: LatLngPoint = start;

  while (unvisited.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const distance = haversineDistance(current, unvisited[i]!.location!);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const next = unvisited[bestIndex]!;
    ordered.push(next._id);
    current = next.location!;
    unvisited.splice(bestIndex, 1);
  }

  for (const stop of withoutLocation) {
    ordered.push(stop._id);
  }

  return ordered;
};

export interface OptimizeRouteInput {
  start?: LatLngPoint;
}

/**
 * Reorders a route's stops by proximity from `start` (the driver's/depot's
 * position). Falls back to the first located stop when no `start` is given.
 * Stops without coordinates keep their relative order at the end. No-op when
 * the route has no located stops. Only planned routes can be optimized.
 */
export const optimizeRoute = async (
  routeId: string,
  input: OptimizeRouteInput = {}
): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }
  if (route.status !== 'planned') {
    throw new AppError('Can only optimize stops on planned routes', 409);
  }

  const locatedStops = route.stops.filter((s) => s.location);
  if (locatedStops.length === 0) {
    // Nothing to reorder — stop order stays as-is.
    return route;
  }

  const start: LatLngPoint = input.start ?? locatedStops[0]!.location!;

  const orderedIds = nearestNeighborOrder(
    route.stops.map((s) => ({
      _id: s._id.toString(),
      sequence: s.sequence,
      location: s.location
    })),
    start
  );

  orderedIds.forEach((stopId, index) => {
    const stop = route.stops.id(stopId);
    if (stop) {
      stop.sequence = index + 1;
    }
  });

  await route.save();
  return Route.findById(routeId) as Promise<IRoute>;
};

// ─── Reorder Stops ──────────────────────────────────────────────────────────

export const reorderStops = async (routeId: string, stopOrder: string[]): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }
  if (route.status !== 'planned') {
    throw new AppError('Can only reorder stops on planned routes', 409);
  }

  // Validate all stop IDs exist in route
  const routeStopIds = new Set(route.stops.map((s) => s._id.toString()));
  for (const id of stopOrder) {
    if (!routeStopIds.has(id)) {
      throw new AppError(`Stop ${id} not found in route`, 404);
    }
  }
  if (stopOrder.length !== route.stops.length) {
    throw new AppError('stopOrder must include all stops in the route', 400);
  }

  // Update sequences
  stopOrder.forEach((stopId, index) => {
    const stop = route.stops.id(stopId);
    if (stop) {
      stop.sequence = index + 1;
    }
  });

  await route.save();
  return Route.findById(routeId) as Promise<IRoute>;
};

// ─── Start Route ────────────────────────────────────────────────────────────

export const startRoute = async (routeId: string): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }

  if (!isValidRouteTransition(route.status, 'in_progress')) {
    throw new AppError(
      `Invalid route status transition: cannot go from "${route.status}" to "in_progress"`,
      409
    );
  }

  route.status = 'in_progress';
  route.startedAt = new Date();
  await route.save();
  return route;
};

// ─── Complete Route ─────────────────────────────────────────────────────────

export interface CompleteRouteInput {
  kmTravelled?: number;
}

export const completeRoute = async (
  routeId: string,
  input: CompleteRouteInput = {}
): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }

  if (!isValidRouteTransition(route.status, 'completed')) {
    throw new AppError(
      `Invalid route status transition: cannot go from "${route.status}" to "completed"`,
      409
    );
  }

  // All stops must be delivered or skipped
  const pendingStops = route.stops.filter(
    (s) => s.status === 'pending' || s.status === 'in_transit'
  );
  if (pendingStops.length > 0) {
    throw new AppError(
      `Cannot complete route: ${pendingStops.length} stop(s) still pending or in transit`,
      409
    );
  }

  if (input.kmTravelled !== undefined) {
    route.kmTravelled = input.kmTravelled;
  }

  route.status = 'completed';
  route.completedAt = new Date();
  await route.save();
  return route;
};

// ─── Cancel Route ───────────────────────────────────────────────────────────

export const cancelRoute = async (routeId: string): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }

  if (!isValidRouteTransition(route.status, 'cancelled')) {
    throw new AppError(
      `Invalid route status transition: cannot go from "${route.status}" to "cancelled"`,
      409
    );
  }

  // Cannot cancel if any stop is in_transit
  const inTransitStops = route.stops.filter((s) => s.status === 'in_transit');
  if (inTransitStops.length > 0) {
    throw new AppError(
      'Cannot cancel route: some stops are in transit',
      409
    );
  }

  // Clear route links from all pending stops
  for (const stop of route.stops) {
    if (stop.status === 'pending') {
      await clearRouteFromOrder(stop.orderId.toString());
    }
  }

  route.status = 'cancelled';
  await route.save();
  return Route.findById(routeId) as Promise<IRoute>;
};

// ─── Advance Stop (Driver Operation) ────────────────────────────────────────

export interface AdvanceStopInput {
  newStatus: StopStatus;
  notes?: string;
  failedReason?: string;
}

export const advanceStop = async (
  routeId: string,
  stopId: string,
  input: AdvanceStopInput,
  driverId?: string
): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }

  // Validate driver owns route (if driverId provided — admin can skip this)
  if (driverId && route.driverId.toString() !== driverId) {
    throw new AppError('Driver does not own this route', 403);
  }

  if (route.status !== 'in_progress') {
    throw new AppError('Route must be in progress to advance stops', 409);
  }

  const stop = route.stops.id(stopId);
  if (!stop) {
    throw new AppError('Stop not found in route', 404);
  }

  if (!isValidStopTransition(stop.status, input.newStatus)) {
    throw new AppError(
      `Invalid stop status transition: cannot go from "${stop.status}" to "${input.newStatus}"`,
      409
    );
  }

  stop.status = input.newStatus;
  if (input.notes !== undefined) {
    stop.notes = input.notes;
  }
  if (input.failedReason !== undefined) {
    stop.failedReason = input.failedReason;
  }
  if (input.newStatus === 'delivered') {
    stop.deliveredAt = new Date();
  }

  // Auto-decrement inventory when stop is delivered.
  // Stock is tracked in maples, so the shared order helper deducts by mapleQty
  // (cajón items were converted at order creation), netting any return already
  // registered on the order. It validates the whole plan before writing and
  // compensates on failure, so a rejected delivery leaves no partial deduction.
  if (input.newStatus === 'delivered') {
    const order = await Order.findById(stop.orderId);
    if (order && !order.stockDeducted) {
      await deductStockForOrder(
        order,
        driverId ?? 'system',
        `Entrega ${order.orderNumber}`
      );
      // Track that this order's stock left the warehouse, so undoing the
      // delivery or cancelling the order can restore it. Persisted BEFORE the
      // order transition, which then sees the flag and skips its own decrement.
      order.stockDeducted = true;
      await order.save();
    }
  }

  await route.save();

  // Transition order status accordingly
  if (input.newStatus === 'in_transit') {
    await transitionOrderStatus(stop.orderId.toString(), 'in_transit');
  } else if (input.newStatus === 'delivered') {
    await transitionOrderStatus(stop.orderId.toString(), 'delivered');
  } else if (input.newStatus === 'skipped') {
    // Skipped stops: order goes back to assigned (available for re-routing)
    await clearRouteFromOrder(stop.orderId.toString());
  }

  return Route.findById(routeId) as Promise<IRoute>;
};

// ─── Add Stop Note ──────────────────────────────────────────────────────────

export const addStopNote = async (
  routeId: string,
  stopId: string,
  notes: string,
  driverId?: string
): Promise<IRoute> => {
  const route = await Route.findById(routeId);
  if (!route) {
    throw new AppError('Route not found', 404);
  }

  if (driverId && route.driverId.toString() !== driverId) {
    throw new AppError('Driver does not own this route', 403);
  }

  const stop = route.stops.id(stopId);
  if (!stop) {
    throw new AppError('Stop not found in route', 404);
  }

  stop.notes = notes;
  await route.save();
  return Route.findById(routeId) as Promise<IRoute>;
};
