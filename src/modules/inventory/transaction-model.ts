import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export interface ITransaction extends Document {
  productId: Types.ObjectId;
  type: 'sale' | 'purchase' | 'adjustment' | 'delivery' | 'opening' | 'classification' | 'return';
  quantity: number;
  orderId?: Types.ObjectId;
  /** Reliable link to the source purchase; the `notes` text is display-only. */
  purchaseId?: Types.ObjectId;
  /** Shared link for grouped transactions (e.g. one classify action → format `classify-{uuid}`). */
  referenceId?: string;
  notes: string;
  createdBy: string;
  createdAt: Date;
}

export const transactionSchema = new Schema<ITransaction>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: {
      type: String,
      required: true,
      enum: ['sale', 'purchase', 'adjustment', 'delivery', 'opening', 'classification', 'return']
    },
    quantity: { type: Number, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    // Reliable link to the source purchase (the "Compra PUR-…" note is display-only).
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', default: null },
    referenceId: { type: String, default: null },
    notes: { type: String, default: '' },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

transactionSchema.index({ productId: 1, createdAt: -1 });

// Append-only: disable update and delete operations at schema level
transactionSchema.pre('findOneAndUpdate', function () {
  throw new Error('Transactions are append-only');
});
transactionSchema.pre('findOneAndDelete', function () {
  throw new Error('Transactions are append-only');
});
transactionSchema.pre('deleteOne', { document: true }, function () {
  throw new Error('Transactions are append-only');
});
transactionSchema.pre('deleteMany', function () {
  throw new Error('Transactions are append-only');
});

export const StockTransaction = createScopedModel<ITransaction>('StockTransaction', transactionSchema);
