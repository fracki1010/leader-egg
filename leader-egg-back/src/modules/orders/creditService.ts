import { Types } from 'mongoose';
import { Order } from './model.js';
import { Customer } from '../customers/model.js';
import { manualBalanceDeltaForCustomer } from '../customer-charges/service.js';

// ─── Due date computation ────────────────────────────────────────────────────

/**
 * Computes the due date for an order based on credit term days.
 * Returns null if termDays is 0 or undefined (cash customer).
 *
 * @param termDays - Credit payment term in days
 * @param orderDate - The date the order is created (defaults to now)
 * @returns The computed due date or null for cash customers
 */
export const computeDueDate = (termDays: number, orderDate: Date = new Date()): Date | null => {
  if (!termDays || termDays <= 0) {
    return null;
  }
  const due = new Date(orderDate);
  due.setDate(due.getDate() + termDays);
  return due;
};

// ─── Customer outstanding balance ────────────────────────────────────────────

export interface CustomerOutstanding {
  customerId: string;
  outstandingBalance: number;
  orderCount: number;
}

/**
 * Computes the total outstanding balance for a customer using the canonical
 * debt definition shared with accounts and customer-payments:
 *
 *   debt = Σ balance of NON-CANCELLED orders
 *        + Customer.openingDebt
 *        + (Σ CustomerCharge 'charge' − Σ CustomerCharge 'credit')
 *
 * Cancellation excludes an order from debt because the sale no longer exists.
 * Manual charges/credits and the opening debt are per-customer balance
 * primitives, so every consumer of this helper (customer summary, credit-limit
 * checks) sees them exactly once.
 *
 * @param customerId - The customer's ID
 * @returns Aggregated outstanding balance and order count
 */
export const getCustomerOutstanding = async (customerId: string): Promise<CustomerOutstanding> => {
  const [result, manualDelta, customer] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          customerId: new Types.ObjectId(customerId),
          status: { $ne: 'cancelled' },
          paymentStatus: { $in: ['unpaid', 'partial'] }
        }
      },
      {
        $group: {
          _id: '$customerId',
          outstandingBalance: { $sum: '$balance' },
          orderCount: { $sum: 1 }
        }
      }
    ]),
    manualBalanceDeltaForCustomer(customerId),
    Customer.findById(customerId).select('openingDebt').lean()
  ]);

  const openingDebt = (customer as { openingDebt?: number } | null)?.openingDebt ?? 0;

  if (result.length === 0) {
    return { customerId, outstandingBalance: openingDebt + manualDelta, orderCount: 0 };
  }

  const row = result[0];
  return {
    customerId,
    outstandingBalance: (row.outstandingBalance as number) + openingDebt + manualDelta,
    orderCount: row.orderCount as number
  };
};

// ─── Credit limit check ──────────────────────────────────────────────────────

export interface CreditCheckResult {
  allowed: boolean;
  overage?: number;
  outstandingBalance?: number;
  creditLimit?: number;
}

/**
 * Checks whether a new order would exceed the customer's credit limit.
 * Returns { allowed: true } if within limit or if customer has no credit limit.
 * Returns { allowed: false, overage, outstandingBalance, creditLimit } if exceeded.
 *
 * @param customerId - The customer's ID
 * @param newOrderTotal - The total amount of the new order
 * @returns Credit check result with overage details if exceeded
 */
export const checkCreditLimit = async (
  customerId: string,
  newOrderTotal: number
): Promise<CreditCheckResult> => {
  const customer = await Customer.findById(customerId);
  if (!customer) {
    return { allowed: true };
  }

  const creditLimit = customer.creditConfig?.limit ?? 0;

  // No credit limit configured — skip check
  if (creditLimit <= 0) {
    return { allowed: true };
  }

  const { outstandingBalance } = await getCustomerOutstanding(customerId);
  const projected = outstandingBalance + newOrderTotal;

  if (projected > creditLimit) {
    return {
      allowed: false,
      overage: projected - creditLimit,
      outstandingBalance,
      creditLimit
    };
  }

  return { allowed: true, outstandingBalance, creditLimit };
};
