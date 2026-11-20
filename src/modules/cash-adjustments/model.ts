import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import type { MoneyAccount } from '../payments/model.js';

/** Why the manual money movement was made (Spanish labels live on the frontend). */
export type CashAdjustmentReason = 'correction' | 'cash_count' | 'missing' | 'found' | 'other';

/**
 * Sales channel the adjustment belongs to. Mirrors the two daily-close
 * channels so a manual movement lands in the right drawer.
 */
export type AdjustmentChannel = 'reparto' | 'puesto';

export interface ICashAdjustment extends Document {
  date: Date;
  /** Money account the movement hits (Efectivo / Mercado Pago / Banco). */
  account: MoneyAccount;
  /** SIGNED amount: positive adds money, negative removes money. Never 0. */
  amount: number;
  reason: CashAdjustmentReason;
  note?: string;
  channel: AdjustmentChannel;
  /** The admin who registered the adjustment (ref User). */
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const CASH_ADJUSTMENT_REASONS: CashAdjustmentReason[] = [
  'correction',
  'cash_count',
  'missing',
  'found',
  'other'
];

export const cashAdjustmentSchema = new Schema<ICashAdjustment>(
  {
    date: { type: Date, required: true, default: Date.now },
    account: { type: String, required: true, enum: ['cash', 'mp', 'bank'] },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) => Number.isFinite(value) && value !== 0,
        message: 'Amount must be a non-zero number'
      }
    },
    reason: { type: String, required: true, enum: CASH_ADJUSTMENT_REASONS },
    note: { type: String, trim: true, maxlength: 300 },
    channel: { type: String, required: true, enum: ['reparto', 'puesto'], default: 'reparto' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Query patterns: newest-first history + per-account/date filtering.
cashAdjustmentSchema.index({ date: -1 });
cashAdjustmentSchema.index({ account: 1, date: -1 });

// Append-only: adjustments are financial records that must never be mutated or
// deleted once written (same guard as Return / StockTransaction). A mistake is
// corrected by registering the OPPOSITE adjustment, never by editing history.
cashAdjustmentSchema.pre('findOneAndUpdate', function () {
  throw new Error('Cash adjustments are append-only');
});
cashAdjustmentSchema.pre('findOneAndDelete', function () {
  throw new Error('Cash adjustments are append-only');
});
cashAdjustmentSchema.pre('deleteOne', { document: true }, function () {
  throw new Error('Cash adjustments are append-only');
});
cashAdjustmentSchema.pre('deleteMany', function () {
  throw new Error('Cash adjustments are append-only');
});

export const CashAdjustment = createScopedModel<ICashAdjustment>('CashAdjustment', cashAdjustmentSchema);
