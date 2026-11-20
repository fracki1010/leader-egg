import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import { AppError } from '../../middleware/error-handler.js';
import { PRODUCT_UNIT_ENUM, type ProductUnit } from './units.js';

/** A price is always per unit; alias kept for existing imports. */
export type PriceUnit = ProductUnit;

export interface IPriceEntry extends Document {
  productId: Types.ObjectId;
  price: number;
  /** Which unit this price applies to: 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit: PriceUnit;
  effectiveFrom: Date;
  effectiveTo: Date | null; // null means indefinitely active
  createdAt: Date;
  updatedAt: Date;
}

export const priceEntrySchema = new Schema<IPriceEntry>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    price: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: [...PRODUCT_UNIT_ENUM], default: 'maple' },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null } // null = open-ended
  },
  { timestamps: true }
);

// Compound index for efficient date-range queries
priceEntrySchema.index({ productId: 1, unit: 1, effectiveFrom: 1 });

/**
 * Validate no overlapping date ranges for the same product AND unit.
 * Legacy entries created before the `unit` field existed are treated as
 * 'maple' so they still guard against new maple entries overlapping them.
 * Runs on both insert and update.
 */
priceEntrySchema.pre('save', async function (next) {
  const entry = this;

  // Only validate if dates changed
  if (!entry.isModified('effectiveFrom') && !entry.isModified('effectiveTo') && !entry.isNew) {
    return next();
  }

  const query: Record<string, unknown> = {
    productId: entry.productId,
    _id: { $ne: entry._id } // exclude self on updates
  };

  // Overlap validation is scoped per (productId, unit). Any explicit non-maple
  // unit (medio_cajon, cajon) only collides with the same unit. Entries without
  // a `unit` field (pre-migration docs) are treated as 'maple'.
  if (entry.unit && entry.unit !== 'maple') {
    query.unit = entry.unit;
  } else {
    query.$or = [
      { unit: 'maple' },
      { unit: { $exists: false } }
    ];
  }

  if (entry.effectiveTo === null) {
    // Open-ended entry: overlaps if another entry's range intersects
    // Another entry overlaps if: its effectiveTo is null OR its effectiveTo >= entry.effectiveFrom
    const dateOr: Record<string, unknown>[] = [
      { effectiveTo: null },
      { effectiveTo: { $gte: entry.effectiveFrom } }
    ];
    if (query.$or) {
      // Merge: unit fallback ($or) must combine with the date range ($or)
      const unitOr = query.$or as Record<string, unknown>[];
      delete query.$or;
      query.$and = [
        { $or: unitOr },
        { $or: dateOr }
      ];
    } else {
      query.$or = dateOr;
    }
  } else {
    // Bounded entry: overlaps if another entry's range intersects
    // Another entry overlaps if: its effectiveTo is null (open-ended, always extends past)
    //   OR its effectiveTo >= entry.effectiveFrom AND its effectiveFrom <= entry.effectiveTo
    const dateOr: Record<string, unknown>[] = [
      { effectiveTo: null },
      {
        effectiveFrom: { $lte: entry.effectiveTo },
        effectiveTo: { $gte: entry.effectiveFrom }
      }
    ];
    if (query.$or) {
      const unitOr = query.$or as Record<string, unknown>[];
      delete query.$or;
      query.$and = [
        { $or: unitOr },
        { $or: dateOr }
      ];
    } else {
      query.$or = dateOr;
    }
  }

  const overlapping = await PriceEntry.findOne(query);
  if (overlapping) {
    next(new AppError('Price date ranges must not overlap for the same product and unit', 409));
    return;
  }

  next();
});

export const PriceEntry = createScopedModel<IPriceEntry>('PriceEntry', priceEntrySchema);
