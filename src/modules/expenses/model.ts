import { Schema, type Document, type Types } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';
import type { MoneyAccount } from '../payments/model.js';

export type ExpenseCategory =
  | 'fuel'
  | 'salary'
  | 'maintenance'
  | 'supplies'
  | 'other'
  | 'repair'
  | 'insurance';

export interface IExpense extends Document {
  amount: number;
  category: ExpenseCategory;
  /** Money account the expense is paid from — defaults to 'cash'. */
  account: MoneyAccount;
  date: Date;
  description: string;
  reference?: string;
  /** Optional vehicle tag (ref Vehicle) — powers vehicle detail aggregation. */
  vehicleId: Types.ObjectId | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const expenseSchema = new Schema<IExpense>(
  {
    amount: { type: Number, required: true, min: 0.01 },
    category: {
      type: String,
      required: true,
      enum: ['fuel', 'salary', 'maintenance', 'supplies', 'other', 'repair', 'insurance']
    },
    account: { type: String, enum: ['cash', 'mp', 'bank'], default: 'cash' },
    date: { type: Date, required: true },
    description: { type: String, required: true, trim: true, maxlength: 200 },
    reference: { type: String, trim: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    createdBy: { type: String, required: true }
  },
  { timestamps: true }
);

expenseSchema.index({ vehicleId: 1 });

export const Expense = createScopedModel<IExpense>('Expense', expenseSchema);
