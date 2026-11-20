import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import { PRODUCT_UNIT_ENUM, type ProductUnit } from '../products/units.js';

export type OrderStatus = 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type OrderChannel = 'phone' | 'whatsapp' | 'driver_visit' | 'walk_in';
export type PaymentPreference = 'cash' | 'transfer' | 'credit' | 'cod' | 'partial';
/** Order-level bonification: a fixed money amount or a percentage of the subtotal. */
export type BonificationType = 'amount' | 'percent';
/** Order-level surcharge: a fixed money amount or a percentage of the subtotal. */
export type SurchargeType = 'amount' | 'percent';
/** Where the sale was made (delivery route, market stall, WhatsApp, other). Default 'reparto'. */
export type SalesChannel = 'reparto' | 'puesto' | 'whatsapp' | 'otro';

/** Plain display snapshot consumed directly by MapView / directions URLs (design D1). */
export interface ILatLng {
  lat: number;
  lng: number;
}

export const latLngSchema = new Schema<ILatLng>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 }
  },
  { _id: false }
);

export interface IOrderPromo {
  /** Reference to the promotion that priced this line (immutable snapshot, design D4). */
  promotionId: Types.ObjectId;
  name: string;
  type: 'fixed_price' | 'discount_percent' | 'buy_x_get_y';
  value: number;
  /** null when the promo is unlimited — restore on cancel only applies to stock-limited promos. */
  stockLimit: number | null;
}

export interface IOrderItem {
  productId: Types.ObjectId;
  productName: string;
  /** Quantity in the item's own unit ('maple', 'medio_cajon' or 'cajon'). */
  quantity: number;
  /** 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit: ProductUnit;
  /** Quantity converted to maples (unit-aware, via product.maplesPerCajon). Stock decrement uses this. */
  mapleQty: number;
  /** Per-unit price in the item's unit (e.g. cajón price for cajon items, maple price for maple items). */
  unitPrice: number;
  /** Base (non-promo) unit price — present only when a promo was applied to this line. */
  originalUnitPrice?: number;
  /** Snapshot of the applied promotion — present only when a promo was applied. */
  promo?: IOrderPromo;
  subtotal: number;
}

export interface IOrderBonification {
  /** 'amount' = fixed money discount; 'percent' = percentage of the order subtotal. */
  type: BonificationType;
  /** Raw value entered by the user ($ for 'amount', 0-100 for 'percent'). */
  value: number;
  /** Computed money discount, persisted so reports never re-derive it. */
  amount: number;
}

export interface IOrderSurcharge {
  /** 'amount' = fixed money surcharge; 'percent' = percentage of the order subtotal. */
  type: SurchargeType;
  /** Raw value entered by the user ($ for 'amount', 0-100 for 'percent'). */
  value: number;
  /** Computed money surcharge, persisted so reports never re-derive it. */
  amount: number;
}

export interface IAuditEntry {
  adminUserId: string;
  customerId: string;
  orderId: string;
  overageAmount: number;
  timestamp: Date;
}

export interface IOrder extends Document {
  orderNumber: string;
  customerId: Types.ObjectId;
  customerName: string;
  channel: OrderChannel;
  /** How the customer intends to pay (cash/transfer at delivery, credit,
   *  cod = pays previous balance next delivery, partial = upfront payment). */
  paymentPreference: PaymentPreference;
  /** Where the sale was made — legacy docs lack the field and aggregate as 'reparto'. */
  salesChannel: SalesChannel;
  deliveryAddress: string;
  deliveryNotes?: string;
  deliveryLocation?: ILatLng;
  items: Types.DocumentArray<IOrderItem & { _id: Types.ObjectId }>;
  /** Order-level sum of item subtotals (before any bonification). */
  subtotal: number;
  /** Order-level discount applied on top of `subtotal` (null = none). */
  bonification?: IOrderBonification | null;
  /** Order-level surcharge added on top of the discounted total (null = none). */
  surcharge?: IOrderSurcharge | null;
  /** Final amount to collect: round2(max(0, subtotal - bonification.amount + surcharge.amount)). */
  totalAmount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  balance: number;
  /** Cumulative value returned on this order (Σ return.returnedAmount, default 0). */
  returnedAmount: number;
  dueDate: Date | null;
  /**
   * Business/sale date — when the sale actually happened. This is the single
   * source of truth for every date-based read (reports, dashboard, order
   * filters/sorts/exports, customer history) and is editable.
   *
   * Distinct from:
   *  - `createdAt`: immutable capture timestamp (audit only, may be later than
   *    the sale when historical orders are loaded in one sitting);
   *  - `deliveryDate`: delivery planning, independent of when the sale happened.
   */
  orderDate: Date;
  /** Date the customer wants the delivery (distinct from dueDate = credit term). */
  deliveryDate: Date | null;
  routeId: Types.ObjectId | null;
  routeStopId: Types.ObjectId | null;
  /** Whether this order's stock was decremented at delivery (enables restore on undo/cancel). */
  stockDeducted: boolean;
  auditLog: Types.DocumentArray<IAuditEntry & { _id: Types.ObjectId }>;
  /** sha1 of the customer + sorted item lines; powers the recent-duplicate guard. */
  duplicateFingerprint?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderPromoSchema = new Schema<IOrderPromo>(
  {
    promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ['fixed_price', 'discount_percent', 'buy_x_get_y'] },
    value: { type: Number, required: true, min: 0 },
    stockLimit: { type: Number, default: null }
  },
  { _id: false }
);

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unit: { type: String, enum: [...PRODUCT_UNIT_ENUM], default: 'maple' },
    // Computed at order creation; absent on legacy orders (fall back to quantity).
    mapleQty: { type: Number, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    // Promo pricing snapshot — only set when a promo was applied to the line.
    originalUnitPrice: { type: Number, min: 0 },
    promo: { type: orderPromoSchema, required: false },
    subtotal: { type: Number, required: true, min: 0 }
  },
  { _id: true }
);

const orderBonificationSchema = new Schema<IOrderBonification>(
  {
    type: { type: String, required: true, enum: ['amount', 'percent'] },
    value: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const orderSurchargeSchema = new Schema<IOrderSurcharge>(
  {
    type: { type: String, required: true, enum: ['amount', 'percent'] },
    value: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const auditEntrySchema = new Schema<IAuditEntry>(
  {
    adminUserId: { type: String, required: true },
    customerId: { type: String, required: true },
    orderId: { type: String, required: true },
    overageAmount: { type: Number, required: true, min: 0 },
    timestamp: { type: Date, required: true, default: Date.now }
  },
  { _id: true }
);

export const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, immutable: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true, trim: true },
    channel: { type: String, required: true, enum: ['phone', 'whatsapp', 'driver_visit', 'walk_in'] },
    paymentPreference: { type: String, required: true, enum: ['cash', 'transfer', 'credit', 'cod', 'partial'], default: 'cash' },
    salesChannel: { type: String, enum: ['reparto', 'puesto', 'whatsapp', 'otro'], default: 'reparto' },
    deliveryAddress: { type: String, default: '', trim: true },
    deliveryNotes: { type: String, trim: true },
    deliveryLocation: { type: latLngSchema, required: false },
    items: { type: [orderItemSchema], required: true, validate: { validator: (v: unknown[]) => (v as unknown[]).length > 0, message: 'At least one item is required' } },
    // Optional so legacy orders (created before this field existed) can still be
    // saved; the post-init hook below backfills it in memory on read.
    subtotal: { type: Number, min: 0 },
    bonification: { type: orderBonificationSchema, default: null },
    surcharge: { type: orderSurchargeSchema, default: null },
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, required: true, enum: ['pending', 'assigned', 'in_transit', 'delivered', 'cancelled'], default: 'pending' },
    paymentStatus: { type: String, required: true, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    paidAmount: { type: Number, required: true, default: 0, min: 0 },
    returnedAmount: { type: Number, default: 0, min: 0 },
    balance: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, default: null },
    // Business/sale date. Required going forward; legacy docs without it are
    // handled by the dual-branch reads and the backfill script.
    orderDate: { type: Date, required: true, default: Date.now },
    deliveryDate: { type: Date, default: null },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route', default: null },
    routeStopId: { type: Schema.Types.ObjectId, default: null },
    stockDeducted: { type: Boolean, default: false },
    auditLog: { type: [auditEntrySchema], default: [] },
    // Set on creation when supported; legacy docs simply lack it.
    duplicateFingerprint: { type: String, index: false }
  },
  { timestamps: true }
);

// Primary lookup for every date-based view (newest sale first).
orderSchema.index({ orderDate: -1 });

// Recent-duplicate guard: same fingerprint, newest first within the window.
orderSchema.index({ duplicateFingerprint: 1, createdAt: -1 });

// Legacy docs predate the order-level subtotal/bonification/surcharge fields.
// Backfill them in memory on hydrate so serialization always exposes a coherent
// shape (subtotal falls back to the stored total; no adjustment means null).
orderSchema.post('init', function (this: IOrder) {
  if (this.subtotal == null) {
    this.subtotal = this.totalAmount;
  }
  if (this.bonification === undefined) {
    this.bonification = null;
  }
  if (this.surcharge === undefined) {
    this.surcharge = null;
  }
});

export const Order = createScopedModel<IOrder>('Order', orderSchema);
