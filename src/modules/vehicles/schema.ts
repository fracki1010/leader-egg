import { z } from 'zod';

export const FUEL_TYPES = ['nafta', 'diesel', 'gas'] as const;

// Create schema. No `.default()` on fuelType here — the mongoose schema
// applies the 'nafta' default at persist time, and keeping the zod schema
// default-free means `partial()` below never clobbers fields on update.
export const createVehicleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  model: z.string().trim().max(100).optional(),
  plate: z.string().trim().min(1).max(20),
  fuelType: z.enum(FUEL_TYPES).optional(),
  km: z.number().min(0).optional(),
  consumptionKmPerL: z.number().min(0).optional(),
  insuranceCost: z.number().min(0).optional(),
  maintenanceCost: z.number().min(0).optional(),
  // nullable → clients can clear the assignment (driver select "no driver")
  driverId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(500).optional()
});

export const updateVehicleSchema = createVehicleSchema.partial();

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

// Query schema for GET /vehicles — active-only by default unless
// `includeInactive=true` is passed.
export const listVehiclesQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional()
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type UpdateVehicleStatusInput = z.infer<typeof updateStatusSchema>;
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;