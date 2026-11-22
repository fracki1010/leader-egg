import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import { latLngSchema, type ILatLng } from '../orders/model.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RouteStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type StopStatus = 'pending' | 'in_transit' | 'delivered' | 'skipped';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface IRouteStop {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  sequence: number;
  status: StopStatus;
  deliveredAt: Date | null;
  failedReason: string;
  notes: string;
  /** Coordinates snapshot taken when the stop was created (design D6). */
  location?: ILatLng;
  /** Payment preference snapshot — the driver knows what to collect (design: payment preferences). */
  paymentPreference: string;
  /** Order balance at stop creation — amount the driver should collect. */
  balanceToCollect: number;
}

export interface IRoute extends Document {
  routeNumber: string;
  driverId: Types.ObjectId;
  driverName: string;
  /** Optional vehicle assignment (ref Vehicle) — snapshot pattern mirrors driverName. */
  vehicleId: Types.ObjectId | null;
  /** vehicleName snapshot taken at creation; '' when no vehicle assigned. */
  vehicleName: string;
  /** Km travelled on completion; null until the route is completed with a value. */
  kmTravelled: number | null;
  plannedDate: Date;
  status: RouteStatus;
  stops: Types.DocumentArray<IRouteStop>;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const routeStopSchema = new Schema<IRouteStop>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true, trim: true },
    customerAddress: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'in_transit', 'delivered', 'skipped'],
      default: 'pending'
    },
    deliveredAt: { type: Date, default: null },
    failedReason: { type: String, default: '' },
    notes: { type: String, default: '' },
    location: { type: latLngSchema, required: false },
    paymentPreference: { type: String, enum: ['cash', 'transfer', 'credit', 'cod', 'partial'], default: 'cash' },
    balanceToCollect: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

export const routeSchema = new Schema<IRoute>(
  {
    routeNumber: { type: String, required: true, unique: true, immutable: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    driverName: { type: String, required: true, trim: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    vehicleName: { type: String, default: '', trim: true },
    kmTravelled: { type: Number, default: null, min: 0 },
    plannedDate: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ['planned', 'in_progress', 'completed', 'cancelled'],
      default: 'planned'
    },
    stops: { type: [routeStopSchema], default: [] },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Index for "today's routes" queries
routeSchema.index({ plannedDate: 1 });
routeSchema.index({ driverId: 1, plannedDate: 1 });

export const Route = createScopedModel<IRoute>('Route', routeSchema);
