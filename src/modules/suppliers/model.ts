import { Schema, type Document } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export interface ISupplier extends Document {
  name: string;
  contact: string;
  phone: string;
  /** Debt owed TO this supplier at punto cero (initial balance). */
  openingDebt: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const supplierSchema = new Schema<ISupplier>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    contact: { type: String, default: '', trim: true, maxlength: 100 },
    phone: { type: String, default: '', trim: true, maxlength: 50 },
    openingDebt: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

// Name index for sorted listings and future search
supplierSchema.index({ name: 1 });

export const Supplier = createScopedModel<ISupplier>('Supplier', supplierSchema);