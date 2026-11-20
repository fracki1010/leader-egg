import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import type { MoneyAccount } from '../payments/model.js';
import { PRODUCT_UNIT_ENUM, type ProductUnit } from '../products/units.js';

export type ReturnReason = 'broken' | 'difference' | 'product_change' | 'other';
export type ReturnEffect = 'refund_cash' | 'refund_transfer' | 'reduce_debt' | 'no_refund';

export interface IReturnItem {
  productId: Types.ObjectId;
  productName: string;
  /** Returned quantity in the item's own unit ('maple', 'medio_cajon' or 'cajon') — same unit as the order line. */
  quantity: number;
  unit: ProductUnit;
  /** Quantity converted to maples (unit-aware, via product.maplesPerCajon) — stock restore uses this. */
  mapleQty: number;
  /** Price snapshot from the order item (per-unit in the item's unit). */
  unitPrice: number;
  subtotal: number;
}

export interface IReturn extends Document {
  orderId: Types.ObjectId;
  customerId: Types.ObjectId;
  date: Date;
  items: Types.DocumentArray<IReturnItem & { _id: Types.ObjectId }>;
  /** Effective value of the returned goods (line subtotals × order discount factor). */
  returnedAmount: number;
  /** Explicit alias of `returnedAmount` — kept for the additive response contract. */
  returnedValue: number;
  /** Portion of the effective value that cancelled unpaid order debt. */
  debtCancelled: number;
  /** Paid portion turned into store credit (saldo a favor) instead of cash. */
  creditIssued: number;
  refundAmount: number;
  /** Money account the refund is paid from (null = no money moved). */
  refundAccount: MoneyAccount | null;
  reason: ReturnReason;
  effect: ReturnEffect;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const returnItemSchema = new Schema<IReturnItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unit: { type: String, enum: [...PRODUCT_UNIT_ENUM], default: 'maple' },
    mapleQty: { type: Number, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 }
  },
  { _id: true }
);

export const returnSchema = new Schema<IReturn>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    date: { type: Date, required: true, default: Date.now },
    items: { type: [returnItemSchema], required: true },
    returnedAmount: { type: Number, required: true, min: 0 },
    returnedValue: { type: Number, default: 0, min: 0 },
    debtCancelled: { type: Number, default: 0, min: 0 },
    creditIssued: { type: Number, default: 0, min: 0 },
    refundAmount: { type: Number, required: true, default: 0, min: 0 },
    refundAccount: { type: String, enum: ['cash', 'mp', 'bank', null], default: null },
    reason: { type: String, required: true, enum: ['broken', 'difference', 'product_change', 'other'] },
    effect: { type: String, required: true, enum: ['refund_cash', 'refund_transfer', 'reduce_debt', 'no_refund'] },
    notes: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: String, required: true }
  },
  { timestamps: true }
);

// Indexes for the query patterns: per-order listing, per-customer/date/reason listing.
returnSchema.index({ orderId: 1, date: -1 });
returnSchema.index({ customerId: 1, date: -1 });
returnSchema.index({ reason: 1 });

// Append-only: returns are financial records that must never be mutated or
// deleted (same guard as StockTransaction).
returnSchema.pre('findOneAndUpdate', function () {
  throw new Error('Returns are append-only');
});
returnSchema.pre('findOneAndDelete', function () {
  throw new Error('Returns are append-only');
});
returnSchema.pre('deleteOne', { document: true }, function () {
  throw new Error('Returns are append-only');
});
returnSchema.pre('deleteMany', function () {
  throw new Error('Returns are append-only');
});

export const Return = createScopedModel<IReturn>('Return', returnSchema);