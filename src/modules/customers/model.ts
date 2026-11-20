import { Schema, type Document } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export type CustomerType = 'B2B' | 'B2C';
export type CustomerStatus = 'active' | 'inactive';

/**
 * GeoJSON Point stored as `coordinates: [lng, lat]` (longitude first).
 * Enables future 2dsphere proximity queries (route clustering).
 */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

/**
 * Structured address fields. All optional — `ICustomer.address` remains the
 * REQUIRED composed display string ("Calle Número, Barrio, Ciudad, Provincia")
 * used by orders/routes snapshots; this subdocument just keeps the parts.
 */
export interface AddressDetail {
  street?: string; // calle
  number?: string; // número
  floor?: string; // piso/depto
  neighborhood?: string; // barrio
  city?: string; // ciudad
  province?: string; // provincia
  postalCode?: string; // código postal
  reference?: string; // referencias (cerca de...)
}

export interface ICustomer extends Document {
  name: string;
  type: CustomerType;
  phone: string;
  address: string;
  addressDetail?: AddressDetail;
  email?: string;
  taxId?: string;
  location?: GeoPoint;
  creditConfig: {
    limit: number;
    termDays: number;
  };
  /** Debt brought into the business at punto cero (initial balance). */
  openingDebt: number;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

const geoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) => value.length === 2,
        message: 'coordinates must be [lng, lat]'
      }
    }
  },
  { _id: false }
);

const addressDetailSchema = new Schema<AddressDetail>(
  {
    street: { type: String, trim: true },
    number: { type: String, trim: true },
    floor: { type: String, trim: true },
    neighborhood: { type: String, trim: true },
    city: { type: String, trim: true },
    province: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    reference: { type: String, trim: true }
  },
  { _id: false }
);

export const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    type: { type: String, required: true, enum: ['B2B', 'B2C'] },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    addressDetail: { type: addressDetailSchema, required: false },
    email: { type: String, trim: true, lowercase: true },
    taxId: { type: String, trim: true },
    location: { type: geoPointSchema, required: false },
    creditConfig: {
      limit: { type: Number, default: 0, min: 0 },
      termDays: { type: Number, default: 0, min: 0 }
    },
    openingDebt: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

// taxId (CUIT/CUIL) is optional — not required for either B2B or B2C

// GeoJSON 2dsphere index enables $near / proximity queries on customer location
customerSchema.index({ location: '2dsphere' });

export const Customer = createScopedModel<ICustomer>('Customer', customerSchema);
