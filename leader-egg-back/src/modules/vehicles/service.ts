import { AppError } from '../../middleware/error-handler.js';
import { Types, type HydratedDocument } from 'mongoose';
import { Vehicle, type IVehicle } from './model.js';
import { User } from '../auth/model.js';
import { Expense } from '../expenses/model.js';
import { Route, type IRoute } from '../routes/model.js';
import type { CreateVehicleInput, UpdateVehicleInput } from './schema.js';

export interface VehicleQueryFilters {
  includeInactive?: boolean;
}

// Categories that count toward a vehicle's costs. salary/supplies/other are
// excluded by design — expenses are the ledger for vehicle running costs.
export const COST_CATEGORIES = ['fuel', 'repair', 'insurance', 'maintenance'] as const;

export interface CostByCategory {
  fuel: number;
  repair: number;
  insurance: number;
  maintenance: number;
}

export interface DeliveryStats {
  routesCount: number;
  deliveredStops: number;
  costPerDelivery: number;
}

export interface VehicleDetail {
  costsByCategory: CostByCategory;
  deliveryStats: DeliveryStats;
  recentRoutes: IRoute[];
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ─── List / query ────────────────────────────────────────────────────────────

/**
 * Lists vehicles sorted by name. Active-only by default; pass
 * `includeInactive: true` to return every vehicle.
 */
export const listVehicles = async (filters: VehicleQueryFilters = {}): Promise<HydratedDocument<IVehicle>[]> => {
  const query: Record<string, unknown> = {};
  if (!filters.includeInactive) {
    query.active = true;
  }
  return Vehicle.find(query).sort({ name: 1 });
};

export const getVehicleById = async (id: string): Promise<HydratedDocument<IVehicle>> => {
  const vehicle = await Vehicle.findById(id);
  if (!vehicle) {
    throw new AppError('Vehicle not found', 404);
  }
  return vehicle;
};

// ─── Driver assignment guard ─────────────────────────────────────────────────

const assertDriverExists = async (driverId: string): Promise<void> => {
  const driver = await User.findById(driverId);
  if (!driver) {
    throw new AppError('Driver not found', 404);
  }
  if (driver.role !== 'driver') {
    throw new AppError('Selected user is not a driver', 400);
  }
};

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const createVehicle = async (input: CreateVehicleInput): Promise<HydratedDocument<IVehicle>> => {
  if (input.driverId) {
    await assertDriverExists(input.driverId);
  }

  // Pre-check gives a clean 409 even before the unique index finishes
  // building; the index + duplicate-key catch below is the concurrency guard
  // (same belt-and-suspenders pattern as daily-closes).
  const existing = await Vehicle.findOne({ plate: input.plate });
  if (existing) {
    throw new AppError('A vehicle with this plate already exists', 409);
  }

  try {
    return await Vehicle.create({
      name: input.name,
      model: input.model,
      plate: input.plate,
      fuelType: input.fuelType ?? 'nafta',
      km: input.km,
      consumptionKmPerL: input.consumptionKmPerL,
      insuranceCost: input.insuranceCost,
      maintenanceCost: input.maintenanceCost,
      driverId: input.driverId ?? null,
      notes: input.notes,
      active: true
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('A vehicle with this plate already exists', 409);
    }
    throw error;
  }
};

export const updateVehicle = async (id: string, input: UpdateVehicleInput): Promise<HydratedDocument<IVehicle>> => {
  const vehicle = await getVehicleById(id);

  if (input.driverId) {
    await assertDriverExists(input.driverId);
  }

  if (input.name !== undefined) vehicle.name = input.name;
  // `model` collides with the mongoose Document.model() method, so set it via
  // the generic path setter (schema path name stays `model` on the wire).
  if (input.model !== undefined) vehicle.set('model', input.model);
  if (input.plate !== undefined) {
    const existing = await Vehicle.findOne({ plate: input.plate });
    if (existing && existing._id.toString() !== id) {
      throw new AppError('A vehicle with this plate already exists', 409);
    }
    vehicle.plate = input.plate;
  }
  if (input.fuelType !== undefined) vehicle.fuelType = input.fuelType;
  if (input.km !== undefined) vehicle.km = input.km;
  if (input.consumptionKmPerL !== undefined) vehicle.consumptionKmPerL = input.consumptionKmPerL;
  if (input.insuranceCost !== undefined) vehicle.insuranceCost = input.insuranceCost;
  if (input.maintenanceCost !== undefined) vehicle.maintenanceCost = input.maintenanceCost;
  if (input.driverId !== undefined) {
    // zod guarantees a non-empty string or null; mongoose casts to ObjectId
    // at persist time (same runtime behavior as create).
    vehicle.driverId = (input.driverId ?? null) as Types.ObjectId | null;
  }
  if (input.notes !== undefined) vehicle.notes = input.notes;

  try {
    await vehicle.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('A vehicle with this plate already exists', 409);
    }
    throw error;
  }

  return vehicle;
};

export const setVehicleStatus = async (id: string, active: boolean): Promise<HydratedDocument<IVehicle>> => {
  const vehicle = await getVehicleById(id);

  if (vehicle.active === active) {
    throw new AppError(
      active ? 'Vehicle is already active' : 'Vehicle is already inactive',
      409
    );
  }

  vehicle.active = active;
  await vehicle.save();
  return vehicle;
};

// ─── Vehicle detail (aggregation) ────────────────────────────────────────────

/**
 * Returns the vehicle plus:
 * - costsByCategory: Σ tagged expenses (fuel/repair/insurance/maintenance)
 * - deliveryStats: routesCount + delivered stops + costPerDelivery
 *   (costPerDelivery = Σ tagged expenses ÷ deliveredStops, 0 when no stops)
 * - recentRoutes: latest 10 routes by plannedDate
 */
export const getVehicleDetail = async (id: string): Promise<VehicleDetail> => {
  const vehicle = await getVehicleById(id);

  const [taggedExpenses, routes] = await Promise.all([
    Expense.find({ vehicleId: id, category: { $in: COST_CATEGORIES } }),
    Route.find({ vehicleId: id }).sort({ plannedDate: -1, createdAt: -1 })
  ]);

  const costsByCategory: CostByCategory = { fuel: 0, repair: 0, insurance: 0, maintenance: 0 };
  let taggedTotal = 0;
  for (const expense of taggedExpenses) {
    const category = expense.category as keyof CostByCategory;
    const amount = round2(expense.amount);
    costsByCategory[category] = round2((costsByCategory[category] ?? 0) + amount);
    taggedTotal = round2(taggedTotal + amount);
  }

  const deliveredStops = routes.reduce(
    (sum, route) => sum + route.stops.filter((s) => s.status === 'delivered').length,
    0
  );

  return {
    ...vehicle.toObject(),
    costsByCategory,
    deliveryStats: {
      routesCount: routes.length,
      deliveredStops,
      costPerDelivery: deliveredStops > 0 ? round2(taggedTotal / deliveredStops) : 0
    },
    recentRoutes: routes.slice(0, 10)
  };
};