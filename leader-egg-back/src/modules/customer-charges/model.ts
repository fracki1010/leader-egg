import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

/**
 * SIGNED effect on what the customer owes:
 *  - 'charge' INCREASES the debt (fiado / cuenta corriente)
 *  - 'credit' DECREASES the debt (forgiveness / discount / adjustment)
 */
export type CustomerChargeType = 'charge' | 'credit';

/** Why the manual movement was made (Spanish labels live on the frontend). */
export type CustomerChargeReason = 'manual_debt' | 'adjustment' | 'forgiveness' | 'other';

/** How the charge was created — only manual today; kept for future imports/migrations. */
export type CustomerChargeSource = 'manual';

export interface ICustomerCharge extends Document {
  customerId: Types.ObjectId;
  type: CustomerChargeType;
  /** Always POSITIVE; the sign of the effect comes from `type`. */
  amount: number;
  reason: CustomerChargeReason;
  note?: string;
  date: Date;
  source: CustomerChargeSource;
  /** The admin who registered the charge (ref User). */
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const CUSTOMER_CHARGE_TYPES: CustomerChargeType[] = ['charge', 'credit'];
export const CUSTOMER_CHARGE_REASONS: CustomerChargeReason[] = [
  'manual_debt',
  'adjustment',
  'forgiveness',
  'other'
];
export const CUSTOMER_CHARGE_SOURCES: CustomerChargeSource[] = ['manual'];

export const customerChargeSchema = new Schema<ICustomerCharge>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, required: true, enum: CUSTOMER_CHARGE_TYPES },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) => Number.isFinite(value) && value > 0,
        message: 'Amount must be a positive number'
      }
    },
    reason: { type: String, required: true, enum: CUSTOMER_CHARGE_REASONS },
    note: { type: String, trim: true, maxlength: 300 },
    date: { type: Date, required: true, default: Date.now },
    source: { type: String, required: true, enum: CUSTOMER_CHARGE_SOURCES, default: 'manual' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Query pattern: per-customer chronological history.
customerChargeSchema.index({ customerId: 1, date: -1 });

// Append-only: charges are financial records that must never be mutated or
// deleted once written. A mistake is corrected by registering the OPPOSITE
// entry, never by editing history (same guard as Return / CashAdjustment).
customerChargeSchema.pre('findOneAndUpdate', function () {
  throw new Error('Customer charges are append-only');
});
customerChargeSchema.pre('findOneAndDelete', function () {
  throw new Error('Customer charges are append-only');
});
customerChargeSchema.pre('deleteOne', { document: true }, function () {
  throw new Error('Customer charges are append-only');
});
customerChargeSchema.pre('deleteMany', function () {
  throw new Error('Customer charges are append-only');
});

export const CustomerCharge = createScopedModel<ICustomerCharge>('CustomerCharge', customerChargeSchema);
