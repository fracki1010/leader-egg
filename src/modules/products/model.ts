import { Schema, type Document } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

/**
 * Product = variety (egg color) × caliber (size).
 *
 * `surtido` is the unclassified caliber WITHIN a variety (buying unclassified
 * white eggs feeds "Blanco Surtido"). There are 2 varieties × 5 calibers = 10
 * products, uniquely constrained by (variety, caliber).
 */
export type ProductVariety = 'blanco' | 'castaño';
export type ProductCaliber = 'chico' | 'mediano' | 'grande' | 'extragrande' | 'surtido';

export const VARIETIES: ProductVariety[] = ['blanco', 'castaño'];
export const CALIBERS: ProductCaliber[] = ['chico', 'mediano', 'grande', 'extragrande', 'surtido'];

/** Human labels for each variety (masculine article: "el Blanco", "el Castaño"). */
export const VARIETY_LABELS: Record<ProductVariety, string> = {
  blanco: 'Blanco',
  castaño: 'Castaño',
};

/** Human labels for each caliber. */
export const CALIBER_LABELS: Record<ProductCaliber, string> = {
  chico: 'Chico',
  mediano: 'Mediano',
  grande: 'Grande',
  extragrande: 'Extra Grande',
  surtido: 'Surtido',
};

/** @deprecated use CALIBER_LABELS — kept for existing imports. */
export const CALIBER_DISPLAY = CALIBER_LABELS;
/** @deprecated use VARIETY_LABELS — kept for existing imports. */
export const VARIETY_DISPLAY = VARIETY_LABELS;

export const caliberDisplay = (caliber: ProductCaliber): string => CALIBER_LABELS[caliber];
export const varietyDisplay = (variety: ProductVariety): string => VARIETY_LABELS[variety];

/**
 * Derived display name for a product — "Blanco Chico", "Castaño Extra Grande",
 * "Blanco Surtido". Single source of truth for the product's label.
 */
export const displayName = (product: { variety: ProductVariety; caliber: ProductCaliber }): string =>
  `${VARIETY_LABELS[product.variety]} ${CALIBER_LABELS[product.caliber]}`;

export interface IProduct extends Document {
  variety: ProductVariety;
  caliber: ProductCaliber;
  eggsPerMaple: number;
  /** How many maples fit in one cajón (box). Default 12, min 1. */
  maplesPerCajon: number;
  costPrice?: number | null;
  lowStockThreshold: number;
  /** Display name derived from variety + caliber: "Blanco Chico", "Castaño Surtido". */
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export const productSchema = new Schema<IProduct>(
  {
    variety: { type: String, required: true, enum: VARIETIES, trim: true },
    caliber: { type: String, required: true, enum: CALIBERS, trim: true },
    eggsPerMaple: { type: Number, required: true, default: 30, immutable: true },
    maplesPerCajon: { type: Number, required: true, default: 12, min: 1 },
    costPrice: { type: Number, default: null, min: 0 },
    lowStockThreshold: { type: Number, required: true, default: 20, min: 0 }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Display name derived from variety + caliber: "Blanco Chico", "Castaño Surtido", etc.
productSchema.virtual('displayName').get(function (this: IProduct) {
  return displayName(this);
});

// Unique compound index — one product per (variety, caliber) pair.
productSchema.index({ variety: 1, caliber: 1 }, { unique: true });

export const Product = createScopedModel<IProduct>('Product', productSchema);
