import { Types, type PipelineStage } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import { DailyClose, type IDailyClose, type DailyCloseChannel } from './model.js';
import { Payment, type MoneyAccount } from '../payments/model.js';
import { Expense } from '../expenses/model.js';
import { Return } from '../returns/model.js';
import { CashAdjustment } from '../cash-adjustments/model.js';
import { Order } from '../orders/model.js';
import { Purchase } from '../purchases/model.js';
import {
  startOfCalendarDay,
  endOfCalendarDay,
  toCalendarDateString
} from '../../utils/calendar-day.js';
import type {
  CreateDailyCloseInput,
  UpdateDailyCloseInput,
  DailyCloseFilterInput
} from './schema.js';

/** Minimal authenticated-user context needed for the puesto close guard. */
export interface CloseUserContext {
  userId: string;
  role: string;
}

export interface DaySummary {
  date: string;
  ventasHoy: number;
  efectivo: number;
  transferencia: number;
  fiado: number;
  gastos: number;
  maplesVendidos: number;
  resultado: number;
}

export interface DaySummaryResult extends DaySummary {
  /** Σ cash purchase payments dated that day — cash paid out to suppliers. */
  pagosProveedor: number;
  systemCash: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const sumTotal = (rows: Array<{ total?: number }>): number => rows[0]?.total ?? 0;

/**
 * Sales-metric match for one channel's BUSINESS day: stall closes take ONLY
 * salesChannel 'puesto'; the reparto close takes everything else
 * (reparto/whatsapp/otro and legacy docs without the field) — design D4, so the
 * two closes never double count a sale.
 *
 * `orderDate` is the business date; `createdAt` (the immutable capture
 * timestamp) is only a fallback for legacy docs that predate the field — an
 * order loaded today for a sale made last week must not count as today's sale.
 */
const orderMatchForChannel = (start: Date, end: Date, channel: DailyCloseChannel): Record<string, unknown> => ({
  $or: [
    { orderDate: { $gte: start, $lte: end } },
    { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }
  ],
  status: { $ne: 'cancelled' },
  salesChannel: channel === 'puesto' ? 'puesto' : { $ne: 'puesto' }
});

/**
 * Joins a money document (payment/return) to its order and narrows the result
 * to the requested channel. The channel is a property of the ORDER, never of
 * the money doc, so this lookup is the only way to keep a stall payment out of
 * the reparto close while scoping by the movement's own date.
 *
 * `$unwind` without `preserveNullAndEmptyArrays` drops orphans (money whose
 * order was hard-deleted): with no order there is no channel to attribute them
 * to, so they count in neither close instead of leaking into reparto.
 */
const orderChannelLookupStages = (channel: DailyCloseChannel): PipelineStage[] => [
  {
    $lookup: {
      from: Order.collection.name,
      localField: 'orderId',
      foreignField: '_id',
      as: 'order'
    }
  },
  { $unwind: '$order' },
  {
    $match: {
      'order.salesChannel': channel === 'puesto' ? 'puesto' : { $ne: 'puesto' }
    }
  }
];

/**
 * Resolved money account for a payment/refund, mirroring `getSaldos()`:
 * explicit `account`/`refundAccount` wins, otherwise the method/effect decides
 * (cash→cash, check→bank, transfer→mp; cash refund→cash, transfer refund→mp).
 * Kept as aggregation expressions so the close never re-implements the rules
 * with a different branch order than the dashboard.
 */
const paymentAccountExpr = {
  $ifNull: [
    '$account',
    {
      $switch: {
        branches: [
          { case: { $eq: ['$method', 'cash'] }, then: 'cash' },
          { case: { $eq: ['$method', 'check'] }, then: 'bank' }
        ],
        default: 'mp'
      }
    }
  ]
};

const refundAccountExpr = {
  $ifNull: [
    '$refundAccount',
    {
      $switch: {
        branches: [
          { case: { $eq: ['$effect', 'refund_cash'] }, then: 'cash' },
          { case: { $eq: ['$effect', 'refund_transfer'] }, then: 'mp' }
        ],
        default: null
      }
    }
  ]
};

/**
 * Cash paid to suppliers for the day (reparto only), mirroring
 * `buildPurchaseMovements` exactly:
 *  - itemised purchases: sum the payment LINES whose resolved account is
 *    `cash` and whose own `date` falls in the range;
 *  - legacy purchases with no lines: fall back to the scalar
 *    `account`/`paymentMethod` + `paidAmount`, dated by `purchase.date`.
 * A purchase whose lines all fall outside the range contributes nothing (it is
 * never re-attributed through the scalar fallback).
 */
const sumCashSupplierPayments = async (start: Date, end: Date): Promise<number> => {
  const purchases = await Purchase.find({
    paidAmount: { $gt: 0 },
    $or: [{ date: { $gte: start, $lte: end } }, { 'payments.date': { $gte: start, $lte: end } }]
  }).lean();

  let total = 0;
  for (const purchase of purchases) {
    const lines = (purchase.payments ?? []).filter(
      (line) => line.amount > 0 && line.date >= start && line.date <= end
    );

    if (lines.length > 0) {
      for (const line of lines) {
        if (line.account === 'cash') total += line.amount;
      }
      continue;
    }

    if ((purchase.payments ?? []).length === 0 && purchase.date >= start && purchase.date <= end) {
      const account = (purchase.account ??
        (purchase.paymentMethod === 'cash'
          ? 'cash'
          : purchase.paymentMethod === 'check'
            ? 'bank'
            : 'mp')) as MoneyAccount;
      if (account === 'cash') total += purchase.paidAmount;
    }
  }

  return round2(total);
};

/**
 * Computes the aggregates for one local calendar day and channel.
 *
 * TWO date bases, deliberately:
 *  - SALES (`ventasHoy`, `fiado`, `maplesVendidos`) use the BUSINESS date:
 *    `orderDate`, falling back to `createdAt` for legacy docs. A historical
 *    order loaded today is not today's sale.
 *  - MONEY (`efectivo`, `transferencia`, refunds, `gastos`, cash adjustments,
 *    supplier payments) uses the MOVEMENT date: the date stored on the
 *    payment/return/expense/purchase-line doc. Cash entered or left the drawer
 *    the day it moved, whichever business day the order belongs to.
 *
 * Payments and refunds are scoped by their own `date` and joined to their order
 * via `$lookup` so the channel comes from `order.salesChannel` (design D5). The
 * money account is resolved exactly like `getSaldos()` — an explicit
 * `account`/`refundAccount` override always wins, otherwise it is derived from
 * the method/effect. This is what keeps a cash-method payment into Mercado Pago
 * out of `efectivo`, and a `refund_cash` paid from the bank out of the drawer.
 *
 * Order status is NOT filtered on those money joins: the money physically
 * moved, so a same-day cancel must show the payment in `efectivo` and its
 * refund as a negative adjustment, netting to zero in `systemCash`. Only the
 * sales metrics exclude cancelled orders, because the sale itself does not
 * count.
 *
 * This is a CASH close: `gastos` counts only expenses whose resolved account is
 * `cash` (legacy docs without `account` default to cash); an MP/bank expense
 * never touches the drawer. Stall closes own no expenses or supplier payments
 * (both stay 0).
 */
export const computeDaySummary = async (
  date: Date = new Date(),
  channel: DailyCloseChannel = 'reparto'
): Promise<DaySummaryResult> => {
  const start = startOfCalendarDay(date);
  const end = endOfCalendarDay(date);

  const [cashPayments, transferPayments, expenses, cashRefunds, orderRows, cashAdjustments, pagosProveedor] =
    await Promise.all([
      // Money joins scope by the MONEY document's own date, then derive the
      // channel from the order. Cancelled orders are intentionally not filtered:
      // the cash moved, and a same-day payment + refund must net to zero.
      Payment.aggregate([
        {
          $match: {
            date: { $gte: start, $lte: end },
            $expr: { $eq: [paymentAccountExpr, 'cash'] }
          }
        },
        ...orderChannelLookupStages(channel),
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        {
          $match: {
            date: { $gte: start, $lte: end },
            $expr: { $in: [paymentAccountExpr, ['mp', 'bank']] }
          }
        },
        ...orderChannelLookupStages(channel),
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      channel === 'puesto'
        ? Promise.resolve([{ total: 0 }])
        : Expense.aggregate([
            {
              $match: {
                date: { $gte: start, $lte: end },
                $expr: { $eq: [{ $ifNull: ['$account', 'cash'] }, 'cash'] }
              }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ]),
      Return.aggregate([
        {
          $match: {
            date: { $gte: start, $lte: end },
            $expr: { $eq: [refundAccountExpr, 'cash'] }
          }
        },
        ...orderChannelLookupStages(channel),
        { $group: { _id: null, total: { $sum: '$refundAmount' } } }
      ]),
      Order.aggregate([
        { $match: orderMatchForChannel(start, end, channel) },
        {
          $group: {
            _id: null,
            ventasHoy: { $sum: '$totalAmount' },
            fiado: { $sum: '$balance' },
            maplesVendidos: { $sum: { $sum: '$items.mapleQty' } }
          }
        }
      ]),
      // Manual cash adjustments for the day/channel. Only CASH-account
      // movements touch the physical drawer (mp/bank adjustments never change
      // counted cash); channel attribution matches the order split so a stall
      // adjustment never leaks into the reparto drawer. Legacy docs without a
      // channel fall into reparto via the `$ne: 'puesto'` branch.
      CashAdjustment.aggregate([
        {
          $match: {
            date: { $gte: start, $lte: end },
            account: 'cash',
            channel: channel === 'puesto' ? 'puesto' : { $ne: 'puesto' }
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      channel === 'puesto' ? Promise.resolve(0) : sumCashSupplierPayments(start, end)
    ]);

  const orderRow = orderRows[0] as
    | { ventasHoy?: number; fiado?: number; maplesVendidos?: number }
    | undefined;

  const efectivo = round2(sumTotal(cashPayments));
  const transferencia = round2(sumTotal(transferPayments));
  const gastos = round2(sumTotal(expenses));
  const refundsCash = round2(sumTotal(cashRefunds));
  const ventasHoy = round2(orderRow?.ventasHoy ?? 0);
  const fiado = round2(orderRow?.fiado ?? 0);
  const maplesVendidos = orderRow?.maplesVendidos ?? 0;

  const resultado = round2(ventasHoy - gastos);
  // systemCash reflects the physical drawer: cash in − cash expenses − cash
  // refunds + manual cash adjustments − cash paid to suppliers. Closed days are
  // frozen snapshots and are NOT retro-recomputed when a later adjustment lands
  // (same semantics as expenses and refunds — a past close keeps the numbers it
  // was closed with).
  const adjustmentsCash = round2(sumTotal(cashAdjustments));
  const systemCash = round2(efectivo - gastos - refundsCash + adjustmentsCash - pagosProveedor);

  return {
    date: toCalendarDateString(start),
    ventasHoy,
    efectivo,
    transferencia,
    fiado,
    gastos,
    maplesVendidos,
    resultado,
    pagosProveedor: round2(pagosProveedor),
    systemCash
  };
};

/** Preview for a day+channel — computes the summary without persisting anything. */
export const previewClose = async (
  date?: Date,
  channel: DailyCloseChannel = 'reparto'
): Promise<DaySummaryResult> => {
  return computeDaySummary(date ?? new Date(), channel);
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

const dayRange = (date: Date): { $gte: Date; $lte: Date } => ({
  $gte: startOfCalendarDay(date),
  $lte: endOfCalendarDay(date)
});

/**
 * Creates the single close for a local calendar day + channel, freezing the
 * computed summary + systemCash. The pre-check gives a clean 409; the unique
 * (date, channel) index + duplicate-key catch is the real guard under
 * concurrent POSTs.
 */
export const createClose = async (
  input: CreateDailyCloseInput,
  userId: string,
  user?: CloseUserContext
): Promise<IDailyClose> => {
  const channel: DailyCloseChannel = input.channel ?? 'reparto';

  // A stall user may only close their own channel (design D7); the route guard
  // admits 'puesto', so the service enforces the channel boundary.
  if (user?.role === 'puesto' && channel !== 'puesto') {
    throw new AppError('El puesto solo puede registrar el cierre de mostrador', 403);
  }

  const rawDate = input.date ?? new Date();
  const date = startOfCalendarDay(rawDate);

  const existing = await DailyClose.findOne({ date: dayRange(rawDate), channel });
  if (existing) {
    throw new AppError('A daily close already exists for this day and channel', 409);
  }

  const summary = await computeDaySummary(rawDate, channel);

  try {
    return await DailyClose.create({
      date,
      channel,
      systemCash: summary.systemCash,
      countedCash: input.countedCash,
      difference: round2(input.countedCash - summary.systemCash),
      notes: input.notes,
      summary: {
        ventasHoy: summary.ventasHoy,
        efectivo: summary.efectivo,
        transferencia: summary.transferencia,
        fiado: summary.fiado,
        gastos: summary.gastos,
        maplesVendidos: summary.maplesVendidos,
        resultado: summary.resultado,
        pagosProveedor: summary.pagosProveedor
      },
      closedBy: userId
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('A daily close already exists for this day and channel', 409);
    }
    throw error;
  }
};

/**
 * Corrects countedCash/notes only. `difference` is recomputed from the FROZEN
 * systemCash; the summary snapshot and systemCash are never mutated.
 */
export const updateClose = async (
  id: string,
  input: UpdateDailyCloseInput
): Promise<IDailyClose> => {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError('Daily close not found', 404);
  }

  const close = await DailyClose.findById(id);
  if (!close) {
    throw new AppError('Daily close not found', 404);
  }

  if (input.countedCash !== undefined) {
    close.countedCash = input.countedCash;
    close.difference = round2(input.countedCash - close.systemCash);
  }
  if (input.notes !== undefined) {
    close.notes = input.notes;
  }

  await close.save();
  return close;
};

/** Returns the close for a local calendar day + channel, or 404 when none exists. */
export const getCloseByDate = async (
  date: Date,
  channel: DailyCloseChannel = 'reparto'
): Promise<IDailyClose> => {
  const close = await DailyClose.findOne({ date: dayRange(date), channel });
  if (!close) {
    throw new AppError('Daily close not found', 404);
  }
  return close;
};

/** Lists closes whose local day falls in the inclusive from/to range, newest first. */
export const listCloses = async (filter: DailyCloseFilterInput = {}): Promise<IDailyClose[]> => {
  const query: Record<string, unknown> = {};

  if (filter.from || filter.to) {
    const range: Record<string, Date> = {};
    if (filter.from) range.$gte = startOfCalendarDay(filter.from);
    if (filter.to) range.$lte = endOfCalendarDay(filter.to);
    query.date = range;
  }

  if (filter.channel) {
    query.channel = filter.channel;
  }

  return DailyClose.find(query).sort({ date: -1 });
};
