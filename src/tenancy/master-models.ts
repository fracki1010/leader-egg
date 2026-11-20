import { Schema, type Document, type Types } from 'mongoose';
import { createResolvedModel } from './scoped-model.js';
import { getMasterConnection } from './master.js';

/**
 * Master (platform) models.
 *
 * These are the ONLY collections that live in the platform database. They are
 * bound to the dedicated master Connection via `getMasterConnection`, NOT to
 * the scoped-model AsyncLocalStorage path — otherwise a request running inside
 * `runWithTenancy(...)` would resolve them against a tenant database and leak
 * the tenant registry into tenant data.
 *
 * They deliberately do NOT use `createScopedModel`.
 */

// ── Tenant registry ──────────────────────────────────────────────────────────

export interface ITenant extends Document {
  name: string;
  /** URL/login slug. Lowercase, immutable, unique. */
  slug: string;
  /** Physical database name. Immutable, unique. `leader_egg` is tenant #1. */
  dbName: string;
  active: boolean;
  plan?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const tenantSchema = new Schema<ITenant>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      immutable: true
    },
    dbName: { type: String, required: true, unique: true, trim: true, immutable: true },
    active: { type: Boolean, default: true },
    plan: { type: String, trim: true }
  },
  { timestamps: true }
);

// ── Platform-wide email index (login routing) ────────────────────────────────

export interface IEmailIndex extends Document {
  /** Platform-wide unique email → tenant routing key. Lowercase, unique. */
  email: string;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const emailIndexSchema = new Schema<IEmailIndex>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true }
  },
  { timestamps: true }
);

// ── Platform admins ──────────────────────────────────────────────────────────

export interface IPlatformAdmin extends Document {
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export const platformAdminSchema = new Schema<IPlatformAdmin>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true }
);

// ── Platform-bound models ────────────────────────────────────────────────────

export const Tenant = createResolvedModel<ITenant>('Tenant', tenantSchema, getMasterConnection);
export const EmailIndex = createResolvedModel<IEmailIndex>(
  'EmailIndex',
  emailIndexSchema,
  getMasterConnection
);
export const PlatformAdmin = createResolvedModel<IPlatformAdmin>(
  'PlatformAdmin',
  platformAdminSchema,
  getMasterConnection
);
