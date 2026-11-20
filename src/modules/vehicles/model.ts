import { Schema, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export type FuelType = 'nafta' | 'diesel' | 'gas';

// Raw document shape (no `extends Document`): the `model` field would clash
// with the Document.model() method, so we use the raw-doc pattern. Mongoose
// still returns fully-hydrated documents with save()/toObject()/_id.
export interface IVehicle {
  name: string;
  model?: string;
  plate: string;
  fuelType: FuelType;
  km?: number;
  consumptionKmPerL?: number;
  /** Reference-only static value — real costs come from tagged expenses. */
  insuranceCost?: number;
  /** Reference-only static value — real costs come from tagged expenses. */
  maintenanceCost?: number;
  driverId?: Types.ObjectId | null;
  active: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const vehicleSchema = new Schema<IVehicle>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    model: { type: String, trim: true, maxlength: 100 },
    plate: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 20
    },
    fuelType: {
      type: String,
      enum: ['nafta', 'diesel', 'gas'],
      default: 'nafta'
    },
    km: { type: Number, min: 0 },
    consumptionKmPerL: { type: Number, min: 0 },
    insuranceCost: { type: Number, min: 0 },
    maintenanceCost: { type: Number, min: 0 },
    driverId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    active: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 500 }
  },
  { timestamps: true }
);

// Plate uniqueness is enforced by the MongoDB unique index (design decision:
// app-level checks race under concurrency). `unique: true` on the plate path
// auto-creates the index via mongoose autoIndex in dev/test; run
// `Vehicle.syncIndexes()` once in prod.

export const Vehicle = createScopedModel<IVehicle>('Vehicle', vehicleSchema);