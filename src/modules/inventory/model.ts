import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export interface IInventory extends Document {
  productId: Types.ObjectId;
  quantity: number;
  lastUpdated: Date;
}

export const inventorySchema = new Schema<IInventory>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
    quantity: { type: Number, required: true, default: 0, min: 0 },
    lastUpdated: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

inventorySchema.index({ productId: 1 }, { unique: true });

export const Inventory = createScopedModel<IInventory>('Inventory', inventorySchema);
