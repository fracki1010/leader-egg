import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export type PaymentMethod = 'cash' | 'transfer' | 'check';

/** Money account a movement is attributed to (Efectivo / Mercado Pago / Banco). */
export type MoneyAccount = 'cash' | 'mp' | 'bank';

/**
 * Central default attribution: cash→cash, check→bank, transfer→mp. An explicit
 * `override` always wins (e.g. a transfer deposited into the bank account).
 */
export const accountForMethod = (
  method: PaymentMethod,
  override?: MoneyAccount | null
): MoneyAccount => override ?? (method === 'cash' ? 'cash' : method === 'check' ? 'bank' : 'mp');

export interface IPayment extends Document {
  orderId: Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  /** Money account this payment lands in; null → derived from method on read. */
  account: MoneyAccount | null;
  reference?: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const paymentSchema = new Schema<IPayment>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, required: true, enum: ['cash', 'transfer', 'check'] },
    account: { type: String, enum: ['cash', 'mp', 'bank'], default: null },
    reference: { type: String, required: false, trim: true, maxlength: 100 },
    date: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

// Index for efficient queries by order
paymentSchema.index({ orderId: 1 });

export const Payment = createScopedModel<IPayment>('Payment', paymentSchema);
