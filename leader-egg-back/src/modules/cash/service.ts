import type { PipelineStage } from 'mongoose';
import { Payment, accountForMethod, type MoneyAccount, type PaymentMethod } from '../payments/model.js';
import { Expense } from '../expenses/model.js';
import { CashAdjustment } from '../cash-adjustments/model.js';
import { Return } from '../returns/model.js';
import { Purchase } from '../purchases/model.js';
import { getSaldos } from '../dashboard/service.js';
import { startOfCalendarDay, endOfCalendarDay } from '../../utils/calendar-day.js';
import type { MovementFilterInput, MovementType } from './schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** One unified money movement, signed (+ money in, − money out). */
export interface Movement {
  id: string;
  date: string;
  type: MovementType;
  account: MoneyAccount;
  amount: number;
  description: string;
  reference: string | null;
}

/** Signed totals for the filtered range: `in`/`out` are positive magnitudes. */
export interface MovementTotals {
  in: number;
  out: number;
  net: number;
}

export interface MovementListResult {
  movements: Movement[];
  total: number;
  page: number;
  limit: number;
  totals: MovementTotals;
}

export interface CashSummary {
  accounts: { cash: number; mp: number; bank: number; total: number };
  today: MovementTotals;
}

/** A resolved date window; either bound may be absent. */
type DateRange = { $gte?: Date; $lte?: Date } | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Spanish labels for the manual-adjustment reasons (the app is Spanish). */
const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  correction: 'Corrección',
  cash_count: 'Conteo de caja',
  missing: 'Faltante',
  found: 'Sobrante',
  other: 'Otro'
};

/** Snaps `from`/`to` to whole local calendar days; null when no bound is set. */
const dateRange = (from?: Date, to?: Date): DateRange => {
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) range.$gte = startOfCalendarDay(from);
  if (to) range.$lte = endOfCalendarDay(to);
  return Object.keys(range).length > 0 ? range : null;
};

/** Whether an instant falls inside a resolved range (used for payment lines). */
const withinRange = (date: Date, range: DateRange): boolean => {
  if (!range) return true;
  const time = date.getTime();
  if (range.$gte && time < range.$gte.getTime()) return false;
  if (range.$lte && time > range.$lte.getTime()) return false;
  return true;
};

// ─── Per-source movement builders ────────────────────────────────────────────

interface PaymentRow {
  _id: unknown;
  amount: number;
  method: PaymentMethod;
  account: MoneyAccount | null;
  date: Date;
  orderNumber?: string | null;
}

/** Customer payments (cobros) → +amount, account derived from method if unset. */
const buildPaymentMovements = async (range: DateRange): Promise<Movement[]> => {
  const pipeline: PipelineStage[] = [];
  if (range) pipeline.push({ $match: { date: range } });
  pipeline.push(
    { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
    { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        amount: 1,
        method: 1,
        account: 1,
        date: 1,
        orderNumber: '$order.orderNumber'
      }
    }
  );

  const rows = await Payment.aggregate<PaymentRow>(pipeline);

  return rows.map((row) => {
    const orderNumber = row.orderNumber ?? null;
    return {
      id: String(row._id),
      date: row.date.toISOString(),
      type: 'payment' as const,
      account: accountForMethod(row.method, row.account),
      amount: round2(row.amount),
      description: orderNumber ? `Cobro ${orderNumber}` : 'Cobro',
      reference: orderNumber
    };
  });
};

/** Expenses (gastos) → −amount, default account 'cash'. */
const buildExpenseMovements = async (range: DateRange): Promise<Movement[]> => {
  const query: Record<string, unknown> = {};
  if (range) query.date = range;

  const expenses = await Expense.find(query).lean();

  return expenses.map((expense) => ({
    id: String(expense._id),
    date: expense.date.toISOString(),
    type: 'expense' as const,
    account: (expense.account ?? 'cash') as MoneyAccount,
    amount: round2(-expense.amount),
    description: `Gasto: ${expense.description}`,
    reference: expense.reference ?? null
  }));
};

/** Manual cash adjustments → the stored SIGNED amount, as-is. */
const buildAdjustmentMovements = async (range: DateRange): Promise<Movement[]> => {
  const query: Record<string, unknown> = {};
  if (range) query.date = range;

  const adjustments = await CashAdjustment.find(query).lean();

  return adjustments.map((adjustment) => ({
    id: String(adjustment._id),
    date: adjustment.date.toISOString(),
    type: 'adjustment' as const,
    account: adjustment.account as MoneyAccount,
    amount: round2(adjustment.amount),
    description: `Ajuste de caja: ${ADJUSTMENT_REASON_LABELS[adjustment.reason] ?? adjustment.reason}`,
    reference: adjustment.note ?? null
  }));
};

interface ReturnRow {
  _id: unknown;
  refundAmount: number;
  refundAccount: MoneyAccount | null;
  effect: string;
  date: Date;
  orderNumber?: string | null;
}

/** Return refunds → −refundAmount, only when a refund actually moved money. */
const buildRefundMovements = async (range: DateRange): Promise<Movement[]> => {
  const match: Record<string, unknown> = { refundAmount: { $gt: 0 } };
  if (range) match.date = range;

  const rows = await Return.aggregate<ReturnRow>([
    { $match: match },
    { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
    { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        refundAmount: 1,
        refundAccount: 1,
        effect: 1,
        date: 1,
        orderNumber: '$order.orderNumber'
      }
    }
  ]);

  return rows.map((row) => {
    const account = (
      row.refundAccount ??
      (row.effect === 'refund_cash' ? 'cash' : row.effect === 'refund_transfer' ? 'mp' : null)
    ) ?? 'cash';
    const orderNumber = row.orderNumber ?? null;
    return {
      id: String(row._id),
      date: row.date.toISOString(),
      type: 'refund' as const,
      account,
      amount: round2(-row.refundAmount),
      description: orderNumber ? `Devolución ${orderNumber}` : 'Devolución',
      reference: orderNumber
    };
  });
};

/**
 * Purchase payments → −line amount, ONE movement per payment LINE using the
 * line's own account/amount/date (split payments land in each account). Legacy
 * purchases without itemised lines fall back to the scalar account/method +
 * paidAmount, mirroring the dashboard attribution.
 */
const buildPurchaseMovements = async (range: DateRange): Promise<Movement[]> => {
  const query: Record<string, unknown> = { paidAmount: { $gt: 0 } };
  if (range) {
    // Match documents whose own date OR any payment line date falls in range;
    // line dates are re-checked in memory below for exactness.
    query.$or = [{ date: range }, { 'payments.date': range }];
  }

  const purchases = await Purchase.find(query).lean();
  const movements: Movement[] = [];

  for (const purchase of purchases) {
    const lines = (purchase.payments ?? []).filter(
      (line) => line.amount > 0 && withinRange(line.date, range)
    );

    if (lines.length > 0) {
      for (const [index, line] of lines.entries()) {
        // The schema sets `_id: true` on lines but the TS interface omits it.
        const lineId = (line as { _id?: { toString(): string } })._id;
        movements.push({
          id: lineId
            ? `${String(purchase._id)}:${String(lineId)}`
            : `${String(purchase._id)}:${index}`,
          date: line.date.toISOString(),
          type: 'purchase_payment',
          account: line.account as MoneyAccount,
          amount: round2(-line.amount),
          description: `Pago compra ${purchase.purchaseNumber}`,
          reference: purchase.purchaseNumber
        });
      }
      continue;
    }

    // Legacy purchase: no itemised lines, attribute the whole paidAmount.
    if ((purchase.payments ?? []).length === 0 && withinRange(purchase.date, range)) {
      const account = (purchase.account ??
        (purchase.paymentMethod === 'cash'
          ? 'cash'
          : purchase.paymentMethod === 'check'
            ? 'bank'
            : 'mp')) as MoneyAccount;
      movements.push({
        id: String(purchase._id),
        date: purchase.date.toISOString(),
        type: 'purchase_payment',
        account,
        amount: round2(-purchase.paidAmount),
        description: `Pago compra ${purchase.purchaseNumber}`,
        reference: purchase.purchaseNumber
      });
    }
  }

  return movements;
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Unified, filterable, paginated list of every money movement across all
 * accounts. Each source is queried in parallel and the results are merged,
 * filtered, sorted (date DESC, deterministic ties) and paginated in memory.
 * Tenant isolation is automatic through the scoped models.
 */
export const listMovements = async (
  filters: MovementFilterInput
): Promise<MovementListResult> => {
  const range = dateRange(filters.from, filters.to);

  const [payments, expenses, adjustments, refunds, purchaseMovements] = await Promise.all([
    buildPaymentMovements(range),
    buildExpenseMovements(range),
    buildAdjustmentMovements(range),
    buildRefundMovements(range),
    buildPurchaseMovements(range)
  ]);

  let movements: Movement[] = [
    ...payments,
    ...expenses,
    ...adjustments,
    ...refunds,
    ...purchaseMovements
  ];

  if (filters.account) {
    movements = movements.filter((movement) => movement.account === filters.account);
  }
  if (filters.type) {
    movements = movements.filter((movement) => movement.type === filters.type);
  }

  // Newest first; id DESC breaks ties so pagination stays deterministic.
  movements.sort((a, b) => {
    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  // Signed totals over the FULL filtered set (not just the current page).
  let sum = 0;
  const totals: MovementTotals = { in: 0, out: 0, net: 0 };
  for (const movement of movements) {
    sum += movement.amount;
    if (movement.amount > 0) {
      totals.in = round2(totals.in + movement.amount);
    } else if (movement.amount < 0) {
      totals.out = round2(totals.out + Math.abs(movement.amount));
    }
  }
  totals.net = round2(sum);

  const total = movements.length;
  const page = filters.page;
  const limit = filters.limit;
  const skip = (page - 1) * limit;

  return {
    movements: movements.slice(skip, skip + limit),
    total,
    page,
    limit,
    totals
  };
};

/**
 * Per-account position + today's flow for the Caja header. `accounts` reuses
 * the dashboard's saldos computation so the two can never disagree.
 */
export const getCashSummary = async (): Promise<CashSummary> => {
  const now = new Date();

  const [saldos, todayMovements] = await Promise.all([
    getSaldos(),
    listMovements({ from: now, to: now, page: 1, limit: 1 })
  ]);

  return {
    accounts: {
      cash: saldos.efectivo,
      mp: saldos.mercadopago,
      bank: saldos.banco,
      total: saldos.total
    },
    today: todayMovements.totals
  };
};
