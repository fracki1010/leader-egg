import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import type { MoneyAccount } from '../payments/model.js';
import { PRODUCT_UNIT_ENUM, type ProductUnit } from '../products/units.js';

export interface IPurchaseItem {
  productId: Types.ObjectId;
  productName: string;
  /** Unit the item was bought in: 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit: ProductUnit;
  /** Quantity as entered, in the item's own unit (maple, medio cajón or cajón). */
  quantity: number;
  /** Quantity converted to maples (unit-aware, via product.maplesPerCajon). */
  quantityMaples: number;
  /** Unit cost as entered — per maple, per medio cajón or per cajón. */
  unitCost: number;
  /** Cost per maple (unit cost ÷ maples in that unit). */
  unitCostPerMaple: number;
  subtotal: number;
}

export type PurchaseStatus = 'pending' | 'delivered' | 'cancelled';
export type PurchasePaymentMethod = 'cash' | 'transfer' | 'check';
export type PurchasePaymentStatus = 'unpaid' | 'partial' | 'paid';

/**
 * One payment line of a purchase. A purchase can be paid with several methods
 * at once (e.g. half cash / half Mercado Pago), so each "pago" action appends
 * one line per method, all sharing the same `groupId`.
 */
export interface IPurchasePayment {
  method: PurchasePaymentMethod;
  /** Money account this line is attributed to (cash→cash, transfer→mp, check→bank, or an override). */
  account: MoneyAccount;
  amount: number;
  date: Date;
  /** Shared by all lines recorded in the same "pago" action. */
  groupId: string;
  /** Optional external reference (e.g. MP transaction id). */
  reference?: string;
}

export interface IPurchase extends Document {
  purchaseNumber: string;
  supplierId: Types.ObjectId;
  date: Date;
  items: Types.DocumentArray<IPurchaseItem & { _id: Types.ObjectId }>;
  totalCost: number;
  notes: string;
  /** Lifecycle: pending (default) → delivered | cancelled. */
  status: PurchaseStatus;
  /** Set when the purchase is marked delivered (stock enters). */
  deliveredAt: Date | null;
  /** How the purchase was paid (null = not paid yet). */
  paymentMethod: PurchasePaymentMethod | null;
  /**
   * Money account the whole paidAmount is attributed to. Null when nothing has
   * been paid; derived from paymentMethod (cash→cash, transfer→mp, check→bank)
   * unless an explicit override was sent.
   */
  account: MoneyAccount | null;
  /** Derived from paidAmount vs totalCost; stored for query/filter. */
  paymentStatus: PurchasePaymentStatus;
  /** Accumulated payments against this purchase. */
  paidAmount: number;
  /**
   * Itemised payment history — one entry per line of every "pago" action.
   * Legacy documents have no array (or an empty one); their whole `paidAmount`
   * is attributed via the scalar `account`/`paymentMethod` at read time.
   */
  payments: IPurchasePayment[];
  createdBy: string;
  /** sha1 of the supplier + sorted item lines; powers the recent-duplicate guard. */
  duplicateFingerprint?: string;
  createdAt: Date;
  updatedAt: Date;
}

const purchaseItemSchema = new Schema<IPurchaseItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    unit: { type: String, enum: [...PRODUCT_UNIT_ENUM], default: 'maple' },
    quantity: { type: Number, required: true, min: 1 },
    quantityMaples: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    unitCostPerMaple: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 }
  },
  { _id: true }
);

const purchasePaymentSchema = new Schema<IPurchasePayment>(
  {
    method: { type: String, required: true, enum: ['cash', 'transfer', 'check'] },
    account: { type: String, required: true, enum: ['cash', 'mp', 'bank'] },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true, default: Date.now },
    groupId: { type: String, required: true },
    reference: { type: String, required: false, trim: true, maxlength: 100 }
  },
  { _id: true }
);

export const purchaseSchema = new Schema<IPurchase>(
  {
    purchaseNumber: { type: String, required: true, unique: true, immutable: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    date: { type: Date, required: true, default: Date.now },
    items: {
      type: [purchaseItemSchema],
      required: true,
      validate: { validator: (v: unknown[]) => (v as unknown[]).length > 0, message: 'At least one item is required' }
    },
    totalCost: { type: Number, required: true, min: 0 },
    notes: { type: String, default: '', trim: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'delivered', 'cancelled'], default: 'pending' },
    deliveredAt: { type: Date, default: null },
    paymentMethod: { type: String, enum: ['cash', 'transfer', 'check', null], default: null },
    account: { type: String, enum: ['cash', 'mp', 'bank', null], default: null },
    paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    paidAmount: { type: Number, default: 0, min: 0 },
    // Itemised payment lines (default []). Legacy docs simply have none.
    payments: { type: [purchasePaymentSchema], default: [] },
    createdBy: { type: String, required: true },
    // Set on creation when supported; legacy docs simply lack it.
    duplicateFingerprint: { type: String }
  },
  { timestamps: true }
);

// Supplier + date index for the list filters (supplierId, from, to)
purchaseSchema.index({ supplierId: 1, date: -1 });
purchaseSchema.index({ date: -1 });

// Recent-duplicate guard: same fingerprint, newest first within the window.
purchaseSchema.index({ duplicateFingerprint: 1, createdAt: -1 });

export const Purchase = createScopedModel<IPurchase>('Purchase', purchaseSchema);