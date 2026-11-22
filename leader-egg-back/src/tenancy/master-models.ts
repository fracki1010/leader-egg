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

// ── WhatsApp instance routing ────────────────────────────────────────────────

export const WHATSAPP_INSTANCE_STATES = [
  'created',
  'connecting',
  'open',
  'close',
  'unknown'
] as const;

export type WhatsappInstanceState = (typeof WHATSAPP_INSTANCE_STATES)[number];

export interface IWhatsappInstance extends Document {
  /** Owning tenant. One WhatsApp instance per tenant. */
  tenantId: Types.ObjectId;
  /** Evolution instance name (`tenant-${slug}`). Unique and immutable. */
  instanceName: string;
  state: WhatsappInstanceState;
  qrCode?: string | null;
  qrUpdatedAt?: Date | null;
  stateUpdatedAt: Date;
  lastEventAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Routing record for the WhatsApp webhook. It lives in the master DB so an
 * incoming delivery can resolve its tenant before any tenant scope exists.
 * Webhook events update this document only; they never touch tenant data.
 */
export const whatsappInstanceSchema = new Schema<IWhatsappInstance>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true
    },
    instanceName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      immutable: true
    },
    state: { type: String, enum: WHATSAPP_INSTANCE_STATES, default: 'created' },
    qrCode: { type: String, default: null },
    qrUpdatedAt: { type: Date, default: null },
    stateUpdatedAt: { type: Date, default: Date.now },
    lastEventAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// ── Platform-bound models ────────────────────────────────────────────────────

export const Tenant = createResolvedModel<ITenant>('Tenant', tenantSchema, getMasterConnection);
export const WhatsappInstance = createResolvedModel<IWhatsappInstance>(
  'WhatsappInstance',
  whatsappInstanceSchema,
  getMasterConnection
);
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
