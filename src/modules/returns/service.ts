import { Types } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import { Return, type IReturn, type IReturnItem, type ReturnReason } from './model.js';
import { Order } from '../orders/model.js';
import { CustomerCharge } from '../customer-charges/model.js';
import { incrementStock } from '../inventory/service.js';
import { restoreSold } from '../promotions/service.js';
import type { CreateReturnInput } from './schema.js';
import type { OrderUserContext } from '../orders/service.js';

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ─── Create return ───────────────────────────────────────────────────────────

/**
 * Creates an append-only return for an order (design D1/D4).
 *
 * Validation happens BEFORE any write so a failure leaves nothing persisted:
 *  - order exists → 404; status in {in_transit, delivered} → 409
 *  - each returned product must be on the order, and the requested quantity
 *    cannot exceed what remains (ordered − Σ prior returns) → 400
 *  - the EFFECTIVE returned value (line subtotals scaled by the order's
 *    discount/surcharge factor) cannot exceed the order total → 400
 *  - a refund cannot exceed the paid portion of that effective value → 400
 *  - the resulting order financials must satisfy the accounting identity,
 *    otherwise the write is rejected with 500 instead of persisting an
 *    inconsistent order.
 *
 * Write order: Return.create → single order.save() → optional CustomerCharge
 * (saldo a favor) → restock loop. Stock is restored (in maples) ONLY when the
 * order's stock was actually deducted AND the goods are fit to re-enter
 * inventory (reason ≠ 'broken', design D6).
 */
export const createReturn = async (
  orderId: string,
  input: CreateReturnInput,
  user: OrderUserContext
): Promise<IReturn> => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (order.status !== 'in_transit' && order.status !== 'delivered') {
    throw new AppError('Solo se puede devolver un pedido entregado o en camino', 409);
  }

  // Prior returns per product (quantities in the item's own unit) → remaining.
  const priorReturns = await Return.find({ orderId: order._id });
  const returnedByProduct = new Map<string, number>();
  for (const returnDoc of priorReturns) {
    for (const item of returnDoc.items) {
      const key = item.productId.toString();
      returnedByProduct.set(key, (returnedByProduct.get(key) ?? 0) + item.quantity);
    }
  }

  // Validate each returned line against the order snapshot. Line subtotals
  // stay at the original unit-price snapshot; the effective value (below) is
  // what the customer actually paid per unit after any order-level adjustment.
  const items: IReturnItem[] = [];
  // Stock-limited promo bookings to release once the return is persisted. The
  // quantity is in the order item's own unit — exactly what was booked.
  const promoReleases: Array<{ promotionId: string; quantity: number }> = [];
  let returnedSubtotal = 0;
  for (const entry of input.items) {
    const orderItem = order.items.find((item) => item.productId.toString() === entry.productId);
    if (!orderItem) {
      throw new AppError(`Product not in order: ${entry.productId}`, 400);
    }

    const remaining = orderItem.quantity - (returnedByProduct.get(orderItem.productId.toString()) ?? 0);
    if (entry.quantity > remaining) {
      throw new AppError('No se puede devolver más de lo vendido', 400);
    }

    if (orderItem.promo && orderItem.promo.stockLimit != null) {
      promoReleases.push({
        promotionId: orderItem.promo.promotionId.toString(),
        quantity: entry.quantity
      });
    }

    const unit = orderItem.unit ?? 'maple';
    const mapleQty = Math.round(
      (orderItem.mapleQty ?? orderItem.quantity) * (entry.quantity / orderItem.quantity)
    );
    const subtotal = round2(entry.quantity * orderItem.unitPrice);
    returnedSubtotal += subtotal;

    items.push({
      productId: orderItem.productId,
      productName: orderItem.productName,
      quantity: entry.quantity,
      unit,
      mapleQty,
      unitPrice: orderItem.unitPrice,
      subtotal
    });
  }

  // Effective value of the returned goods: the order-level bonificación /
  // recargo is spread proportionally across every line, so a discounted order
  // can never refund the pre-discount price. `factor` is total ÷ subtotal
  // (1 for orders without adjustments, or when the subtotal is unavailable).
  const orderSubtotal =
    order.subtotal ?? order.items.reduce((sum, item) => sum + item.subtotal, 0);
  const factor = orderSubtotal > 0 ? order.totalAmount / orderSubtotal : 1;
  const returnedValue = round2(returnedSubtotal * factor);

  // Cumulative guard: the effective value returned across ALL returns can never
  // exceed the order's effective total (0.01 tolerance for cent rounding).
  const returnedBefore = round2(order.returnedAmount ?? 0);
  const cumulativeReturned = round2(returnedBefore + returnedValue);
  if (cumulativeReturned > round2(order.totalAmount) + 0.01) {
    throw new AppError('Returned amount exceeds order total', 400);
  }

  // Money split at return time.
  //  - debtCancelled: part of the returned value that settles unpaid debt.
  //  - paidPortion:   goods the customer already paid for; the only money that
  //                   can be refunded and/or turned into store credit.
  const balanceBefore = round2(order.balance);
  const debtCancelled = round2(Math.min(balanceBefore, returnedValue));
  const paidPortion = round2(returnedValue - debtCancelled);

  const isRefund = input.effect === 'refund_cash' || input.effect === 'refund_transfer';
  const requestedRefund = isRefund ? round2(input.refundAmount ?? paidPortion) : 0;

  // Legacy guard first (keeps the familiar message): a refund can never exceed
  // what was actually paid. Then the stricter effective-value guard: it can
  // only consume the paid portion of the goods being returned.
  if (requestedRefund > round2(order.paidAmount)) {
    throw new AppError(
      `Refund amount ($${requestedRefund}) exceeds paid amount ($${order.paidAmount})`,
      400
    );
  }
  if (requestedRefund > paidPortion) {
    throw new AppError(
      `Refund amount ($${requestedRefund}) exceeds the paid portion of the returned effective value ($${paidPortion})`,
      400
    );
  }

  const refundAmount = requestedRefund;

  // 'no_refund' is an explicit forgiveness: no cash leaves the business and no
  // store credit is created. Any other effect returns the paid portion as cash
  // (refundAmount) plus store credit for whatever was NOT refunded.
  const creditIssued =
    input.effect === 'no_refund' ? 0 : round2(paidPortion - refundAmount);

  const newBalance = round2(Math.max(0, balanceBefore - debtCancelled));
  const newPaidAmount = round2(Math.max(0, order.paidAmount - refundAmount));
  const newReturnedAmount = round2(returnedBefore + returnedValue);

  // Accounting identity, asserted BEFORE any write: the net value still held by
  // the order (total − returned) must equal what the customer has paid plus the
  // remaining balance, MINUS the store credit issued. The credit offsets the
  // paid amount that was converted into saldo a favor, so it is subtracted.
  // For 'no_refund' the forgiven paid portion plays the same offsetting role
  // even though no CustomerCharge is created (explicit forgiveness).
  const creditOffset = input.effect === 'no_refund' ? paidPortion : creditIssued;
  const invariantLeft = round2(order.totalAmount - newReturnedAmount);
  const invariantRight = round2(newPaidAmount + newBalance - creditOffset);
  if (Math.abs(invariantLeft - invariantRight) > 0.005) {
    throw new AppError(
      `Return would break the order accounting invariant (expected $${invariantLeft}, got $${invariantRight})`,
      500
    );
  }

  // Money account the refund comes from: explicit override wins, otherwise the
  // effect decides (refund_cash→cash, refund_transfer→mp, else no money moved).
  const refundAccount = input.refundAccount ??
    (input.effect === 'refund_cash' ? 'cash' : input.effect === 'refund_transfer' ? 'mp' : null);

  // Persist the return first — append-only, nothing may mutate it later.
  const returnDoc = await Return.create({
    orderId: order._id,
    customerId: order.customerId,
    date: new Date(),
    items,
    returnedAmount: returnedValue,
    returnedValue,
    debtCancelled,
    creditIssued,
    refundAmount,
    refundAccount,
    reason: input.reason,
    effect: input.effect,
    notes: input.notes,
    createdBy: user.userId
  });

  // A returned unit stops counting as sold under a stock-limited promo. Only
  // lines whose order item carried a stock-limited promo snapshot are released;
  // unlimited promos never booked a counter.
  for (const release of promoReleases) {
    await restoreSold(release.promotionId, release.quantity);
  }

  // Order financials — totalAmount is never mutated.
  order.paidAmount = newPaidAmount;
  order.balance = newBalance;
  order.returnedAmount = newReturnedAmount;

  if (newBalance === 0 && newPaidAmount >= round2(order.totalAmount - newReturnedAmount)) {
    order.paymentStatus = 'paid';
  } else if (newPaidAmount > 0) {
    order.paymentStatus = 'partial';
  } else {
    order.paymentStatus = 'unpaid';
  }

  await order.save();

  // Store credit for the paid portion that was not refunded in cash. The
  // customer-charges ledger is append-only and signed: a 'credit' reduces what
  // the customer owes (i.e. a saldo a favor).
  if (creditIssued > 0) {
    await CustomerCharge.create({
      customerId: order.customerId,
      type: 'credit',
      amount: creditIssued,
      reason: 'other',
      note: `Saldo a favor por devolución ${order.orderNumber}`,
      date: new Date(),
      source: 'manual',
      createdBy: user.userId
    });
  }

  // Stock restoration: only when the goods actually left the warehouse AND
  // they are fit to re-enter it (broken goods never return to inventory).
  if (order.stockDeducted && input.reason !== 'broken') {
    for (const item of items) {
      await incrementStock(
        item.productId.toString(),
        item.mapleQty ?? item.quantity,
        `Devolución ${order.orderNumber}`,
        user.userId,
        'return'
      );
    }
  }

  return returnDoc;
};

// ─── Listing ─────────────────────────────────────────────────────────────────

export const listReturnsForOrder = async (orderId: string): Promise<IReturn[]> => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  return Return.find({ orderId }).sort({ date: -1, createdAt: -1 });
};

export interface ReturnListFilters {
  customerId?: string;
  from?: Date;
  to?: Date;
  reason?: ReturnReason;
  limit?: number;
  page?: number;
}

export interface ReturnListResult {
  items: IReturn[];
  total: number;
  page: number;
  limit: number;
}

/** Calendar-date components the client sent (same helper as the orders service). */
const calendarComponents = (value: Date): { y: number; m: number; d: number } => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.toISOString());
  if (!match) {
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
};

const startOfCalendarDay = (value: Date): Date => {
  const { y, m, d } = calendarComponents(value);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

const endOfCalendarDay = (value: Date): Date => {
  const { y, m, d } = calendarComponents(value);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

export const listReturns = async (filter: ReturnListFilters = {}): Promise<ReturnListResult> => {
  const query: Record<string, unknown> = {};

  if (filter.customerId) {
    if (!Types.ObjectId.isValid(filter.customerId)) {
      throw new AppError('Invalid customerId', 400);
    }
    query.customerId = new Types.ObjectId(filter.customerId);
  }
  if (filter.reason) {
    query.reason = filter.reason;
  }

  // Date range: from/to are calendar dates → start/end of the local day.
  if (filter.from || filter.to) {
    const date: Record<string, Date> = {};
    if (filter.from) {
      date.$gte = startOfCalendarDay(filter.from);
    }
    if (filter.to) {
      date.$lte = endOfCalendarDay(filter.to);
    }
    query.date = date;
  }

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Return.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
    Return.countDocuments(query)
  ]);

  return { items, total, page, limit };
};