import { Types } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import { Customer } from '../customers/model.js';
import { CustomerCharge } from '../customer-charges/model.js';
import { manualBalanceDeltaForCustomer } from '../customer-charges/service.js';
import { CashAdjustment } from '../cash-adjustments/model.js';
import { Order } from '../orders/model.js';
import { Payment, accountForMethod } from '../payments/model.js';
import type { CreateCustomerPaymentInput } from './schema.js';

/** One order covered by a customer-level payment. */
export interface CustomerPaymentAllocation {
  orderId: string;
  orderNumber: string;
  /** Order creation date (the FIFO ordering key), ISO-8601. */
  date: string;
  applied: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface CustomerPaymentResult {
  /** Total amount actually allocated (equals the input amount — excess is rejected). */
  applied: number;
  /** Always 0 under the strict (reject-the-excess) policy; kept for the contract. */
  unapplied: number;
  allocations: CustomerPaymentAllocation[];
  /** Portion applied to debt that is NOT tied to an order (opening debt + manual debt). */
  nonOrderApplied: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Records a single payment against a CUSTOMER and allocates it to their total
 * debt, which is made up of three independent terms:
 *
 *   1. open ORDER balances      — FIFO, oldest first (unchanged behaviour)
 *   2. `customer.openingDebt`   — punto-cero initial debt
 *   3. manual debt              — net signed `CustomerCharge` balance
 *                                 (Σ charges − Σ credits, never below 0)
 *
 * Allocation order is **open orders first, then opening debt, then manual
 * debt**. Order balances carry due dates and feed the aging report, so they are
 * settled first; the other two are lump sums with no aging semantics.
 *
 * Cash handling avoids double counting: order allocations already create one
 * `Payment` row each (the cash movement). Only the NON-order portion creates a
 * single `CashAdjustment`, because no `Payment` exists for it.
 *
 * A customer payment has no channel context (it can be registered from the
 * cuenta-corriente screen), so the cash adjustment is attributed to the
 * `reparto` drawer, the default drawer for manual movements.
 *
 * Validation happens BEFORE any write: a customer with no debt (409) or an
 * overpayment (400) never leaves partial payments, credits or adjustments
 * behind.
 */
export const recordCustomerPayment = async (
  customerId: string,
  input: CreateCustomerPaymentInput,
  userId: string
): Promise<CustomerPaymentResult> => {
  if (!Types.ObjectId.isValid(customerId)) {
    throw new AppError('Customer not found', 404);
  }

  // `createdBy` is a required ObjectId on CustomerCharge/CashAdjustment — never
  // use a placeholder. The controller passes the authenticated admin id.
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new AppError('A valid authenticated user is required', 400);
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  // Deterministic FIFO: oldest createdAt first, _id as the tiebreak so orders
  // created in the same millisecond still allocate in a stable order.
  const orders = await Order.find({
    customerId,
    status: { $ne: 'cancelled' },
    balance: { $gt: 0 }
  }).sort({ createdAt: 1, _id: 1 });

  // ── Full debt breakdown (before validating) ───────────────────────────────
  const openOrderTotal = round2(orders.reduce((sum, order) => sum + order.balance, 0));
  const openingDebt = round2(customer.openingDebt ?? 0);
  const manualDebt = round2(Math.max(0, await manualBalanceDeltaForCustomer(customerId)));
  const totalDebt = round2(openOrderTotal + openingDebt + manualDebt);

  const amount = round2(input.amount);

  if (totalDebt <= 0) {
    throw new AppError('Customer has no pending debt', 409);
  }

  // Strict policy (option A): reject the excess, never allocate it elsewhere.
  if (amount > totalDebt) {
    throw new AppError(
      `Payment amount ($${amount}) exceeds the customer's total debt ($${totalDebt})`,
      400
    );
  }

  const paymentDate = input.date ?? new Date();
  let remaining = amount;
  const allocations: CustomerPaymentAllocation[] = [];

  // ── 1. Open orders, oldest first ──────────────────────────────────────────
  for (const order of orders) {
    if (remaining <= 0) {
      break;
    }

    const balanceBefore = round2(order.balance);
    const applied = round2(Math.min(remaining, balanceBefore));
    if (applied <= 0) {
      continue;
    }

    // One Payment row per order, mirroring the per-order recordPayment flow.
    await Payment.create({
      orderId: order._id,
      amount: applied,
      method: input.method,
      account: accountForMethod(input.method, input.account),
      reference: input.reference,
      date: paymentDate
    });

    order.paidAmount = round2(order.paidAmount + applied);
    order.balance = round2(balanceBefore - applied);
    order.paymentStatus = order.balance === 0 ? 'paid' : 'partial';
    await order.save();

    remaining = round2(remaining - applied);

    allocations.push({
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      date: order.createdAt.toISOString(),
      applied,
      balanceBefore,
      balanceAfter: order.balance
    });
  }

  // ── 2 & 3. Non-order debt: opening debt, then manual debt ─────────────────
  let nonOrderApplied = 0;

  if (remaining > 0 && openingDebt > 0) {
    const openingApplied = round2(Math.min(remaining, openingDebt));
    customer.openingDebt = round2(Math.max(0, customer.openingDebt - openingApplied));
    await customer.save();

    nonOrderApplied = round2(nonOrderApplied + openingApplied);
    remaining = round2(remaining - openingApplied);
  }

  if (remaining > 0 && manualDebt > 0) {
    const manualApplied = round2(Math.min(remaining, manualDebt));

    // A credit is a negative signed delta, so the manual debt shrinks by
    // exactly the applied amount. The collection is append-only.
    await CustomerCharge.create({
      customerId,
      type: 'credit',
      amount: manualApplied,
      reason: 'other',
      note: 'Pago aplicado a deuda manual',
      date: paymentDate,
      source: 'manual',
      createdBy: userId
    });

    nonOrderApplied = round2(nonOrderApplied + manualApplied);
    remaining = round2(remaining - manualApplied);
  }

  // Cash for the non-order portion only — order allocations already produced
  // their own Payment rows. One adjustment per payment keeps the ledger tidy.
  if (nonOrderApplied > 0) {
    await CashAdjustment.create({
      date: paymentDate,
      account: accountForMethod(input.method, input.account),
      amount: nonOrderApplied,
      reason: 'other',
      note: `Cobro deuda ${customer.name}`,
      channel: 'reparto',
      createdBy: userId
    });
  }

  return {
    applied: round2(amount - remaining),
    unapplied: remaining,
    allocations,
    nonOrderApplied
  };
};
