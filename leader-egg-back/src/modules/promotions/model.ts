import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import type { PriceUnit } from '../products/price-list-model.js';
import { PRODUCT_UNIT_ENUM } from '../products/units.js';

export type PromotionType = 'fixed_price' | 'discount_percent' | 'buy_x_get_y';
export type PromotionStatus = 'active' | 'inactive';

export interface IPromotion extends Document {
  name: string;
  productId: Types.ObjectId;
  description?: string;
  /** fixed_price → group price (see minQuantity for the group size); discount_percent → % off; buy_x_get_y → buy X get Y total. */
  type: PromotionType;
  value: number;
  /** buy_x_get_y → total units the customer walks away with per group (e.g. "pagás 4 llevás 5" → value 4, getQuantity 5). Null = legacy "buy X get 1 free" (total = value + 1). */
  getQuantity?: number | null;
  /** Which unit the promo applies to: 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit: PriceUnit;
  /**
   * Lower bound of the order-line quantity for the promo to apply (null = no
   * minimum). For fixed_price it doubles as the group size N: the promo is
   * eligible at qty >= N and `value` prices each full group of N units.
   */
  minQuantity?: number | null;
  /** Upper bound of the order-line quantity (caps paid+free for buy_x_get_y). */
  maxQuantity?: number | null;
  /** Max number of units that may ever be sold under this promo (null = unlimited). */
  stockLimit?: number | null;
  /** Units sold under this promo so far — incremented atomically at order creation. */
  soldQuantity: number;
  /** Promo stops being active after this instant (null = no date limit). */
  expiresAt?: Date | null;
  status: PromotionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const promotionSchema = new Schema<IPromotion>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    description: { type: String, default: '', trim: true, maxlength: 300 },
    type: { type: String, required: true, enum: ['fixed_price', 'discount_percent', 'buy_x_get_y'] },
    value: { type: Number, required: true, min: 0 },
    // buy_x_get_y total per group; null = legacy (value + 1)
    getQuantity: { type: Number, min: 1, default: null },
    unit: { type: String, enum: [...PRODUCT_UNIT_ENUM], default: 'maple' },
    minQuantity: { type: Number, min: 1, default: null },
    maxQuantity: { type: Number, min: 1, default: null },
    stockLimit: { type: Number, min: 1, default: null },
    soldQuantity: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  { timestamps: true }
);

// Promo resolution happens per (productId, unit); keep that lookup indexed.
promotionSchema.index({ productId: 1, unit: 1, status: 1 });

export const Promotion = createScopedModel<IPromotion>('Promotion', promotionSchema);