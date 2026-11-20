import { Types } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import type { MoneyAccount } from '../payments/model.js';
import {
  CashAdjustment,
  type ICashAdjustment,
  type CashAdjustmentReason,
  type AdjustmentChannel
} from './model.js';
import type { CreateAdjustmentInput, AdjustmentFilterInput } from './schema.js';
import { startOfCalendarDay, endOfCalendarDay } from '../../utils/calendar-day.js';

export interface CashAdjustmentRow {
  _id: Types.ObjectId;
  date: Date;
  account: MoneyAccount;
  amount: number;
  reason: CashAdjustmentReason;
  note?: string;
  channel: AdjustmentChannel;
  createdBy: Types.ObjectId;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashAdjustmentSummary {
  cash: number;
  mp: number;
  bank: number;
  total: number;
}

export interface CashAdjustmentListResult {
  adjustments: CashAdjustmentRow[];
  total: number;
  page: number;
  limit: number;
  /** Net adjustment per account over the filtered range (signed totals). */
  summary: CashAdjustmentSummary;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Registers a manual money movement. The amount is taken as-is (SIGNED):
 * a positive value adds money, a negative value removes it. createdBy is
 * always the authenticated admin — never client supplied.
 */
export const createAdjustment = async (
  input: CreateAdjustmentInput,
  userId: string
): Promise<ICashAdjustment> => {
  return CashAdjustment.create({
    date: input.date ?? new Date(),
    account: input.account,
    amount: input.amount,
    reason: input.reason,
    note: input.note,
    channel: input.channel ?? 'reparto',
    createdBy: userId
  });
};

/**
 * Paginated, newest-first history of adjustments joined with the creator name.
 * Supports date-range, account and creator filters. There is intentionally NO
 * update or delete counterpart — the ledger is append-only.
 */
export const listAdjustments = async (
  filters: AdjustmentFilterInput
): Promise<CashAdjustmentListResult> => {
  const match: Record<string, unknown> = {};

  if (filters.from || filters.to) {
    // Snap the range to whole local days so the last day is inclusive and
    // noon-anchored (business-date) values are not excluded.
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = startOfCalendarDay(filters.from);
    if (filters.to) range.$lte = endOfCalendarDay(filters.to);
    match.date = range;
  }

  if (filters.account) {
    match.account = filters.account;
  }

  if (filters.createdBy) {
    if (!Types.ObjectId.isValid(filters.createdBy)) {
      throw new AppError('Invalid createdBy filter', 400);
    }
    // Aggregation does not cast strings to ObjectId — cast explicitly.
    match.createdBy = new Types.ObjectId(filters.createdBy);
  }

  const page = filters.page;
  const limit = filters.limit;
  const skip = (page - 1) * limit;

  const [rows, total, summaryRows] = await Promise.all([
    CashAdjustment.aggregate<CashAdjustmentRow>([
      { $match: match },
      { $sort: { date: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'creator' } },
      { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },
      { $addFields: { createdByName: { $ifNull: ['$creator.name', null] } } },
      { $project: { creator: 0 } }
    ]),
    CashAdjustment.countDocuments(match),
    CashAdjustment.aggregate<{ _id: MoneyAccount; total: number }>([
      { $match: match },
      { $group: { _id: '$account', total: { $sum: '$amount' } } }
    ])
  ]);

  const summary: CashAdjustmentSummary = { cash: 0, mp: 0, bank: 0, total: 0 };
  for (const row of summaryRows) {
    summary[row._id] = round2(row.total);
  }
  summary.total = round2(summary.cash + summary.mp + summary.bank);

  return {
    adjustments: rows.map((row) => ({ ...row, amount: round2(row.amount) })),
    total,
    page,
    limit,
    summary
  };
};
