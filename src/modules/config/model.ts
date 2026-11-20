import { Schema, type Document } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

/**
 * Singleton business configuration document (one doc in the collection).
 * Created lazily on first access via `getOrCreateConfig` — the collection
 * stays empty until the app reads or writes setup state.
 */
export interface OpeningBalances {
  cash: number;
  mp: number;
  bank: number;
}

/** Per-account timestamp of the one-time opening-balance load (null = still editable). */
export interface OpeningBalancesSetAt {
  cash: Date | null;
  mp: Date | null;
  bank: Date | null;
}

export interface IBusinessConfig extends Document {
  /** Display name of the business shown in the app header and documents. */
  businessName: string;
  /** Business street address (free text). */
  address: string;
  /** Business contact phone (free text). */
  phone: string;
  /** Cash on hand at business start (punto cero). Folded into dashboard caja. */
  openingCash: number;
  /** Per-account opening balances — `cash` mirrors `openingCash` (alias). */
  openingBalances: OpeningBalances;
  /**
   * When each account's opening balance was loaded for the first time.
   *
   * The opening balance is a one-time starting configuration: once an account
   * is saved with a value > 0 its timestamp is set and any later change is
   * rejected (409). `null` means the account is still editable. Platform reset
   * clears every timestamp so the tenant can load the opening balances again.
   */
  openingBalancesSetAt: OpeningBalancesSetAt;
  /** True once the punto cero setup POST succeeded. Blocks further setup. */
  puntoCeroFinalized: boolean;
  /** When the setup was finalized (set only when puntoCeroFinalized becomes true). */
  puntoCeroFinalizedAt?: Date;
}

const openingBalancesSchema = new Schema<OpeningBalances>(
  {
    cash: { type: Number, default: 0, min: 0 },
    mp: { type: Number, default: 0, min: 0 },
    bank: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const openingBalancesSetAtSchema = new Schema<OpeningBalancesSetAt>(
  {
    cash: { type: Date, default: null },
    mp: { type: Date, default: null },
    bank: { type: Date, default: null }
  },
  { _id: false }
);

export const businessConfigSchema = new Schema<IBusinessConfig>(
  {
    businessName: { type: String, default: '', trim: true, maxlength: 120 },
    address: { type: String, default: '', trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    openingCash: { type: Number, default: 0, min: 0 },
    openingBalances: { type: openingBalancesSchema, default: () => ({ cash: 0, mp: 0, bank: 0 }) },
    openingBalancesSetAt: {
      type: openingBalancesSetAtSchema,
      default: () => ({ cash: null, mp: null, bank: null })
    },
    puntoCeroFinalized: { type: Boolean, default: false },
    puntoCeroFinalizedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const BusinessConfig = createScopedModel<IBusinessConfig>('BusinessConfig', businessConfigSchema);