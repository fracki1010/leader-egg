import { Types, type PipelineStage } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import { Customer } from '../customers/model.js';
import { CustomerCharge, type ICustomerCharge } from './model.js';
import type { CreateCustomerChargeInput } from './schema.js';

/**
 * Mongo aggregation expression for the SIGNED balance contribution of a
 * CustomerCharge: +amount for 'charge', −amount for 'credit'.
 *
 * This is the SINGLE source of the manual-debt balance term — every balance
 * read site (dashboard, accounts, creditService) reuses it so the semantics
 * can never drift apart.
 */
export const CUSTOMER_CHARGE_SIGNED_DELTA: Record<string, unknown> = {
  $cond: [{ $eq: ['$type', 'charge'] }, '$amount', { $multiply: ['$amount', -1] }]
};

/**
 * Registers a manual charge/credit against a customer. `createdBy` is always
 * the authenticated admin — never client supplied. The customer must exist in
 * the caller's tenant (404 otherwise), which also keeps the reference valid.
 */
export const createCharge = async (
  customerId: string,
  input: CreateCustomerChargeInput,
  userId: string
): Promise<ICustomerCharge> => {
  await assertCustomerExists(customerId);

  return CustomerCharge.create({
    customerId,
    type: input.type,
    amount: input.amount,
    reason: input.reason,
    note: input.note,
    date: input.date ?? new Date(),
    source: 'manual',
    createdBy: userId
  });
};

/**
 * Newest-first charge history for one customer. 404 when the customer does not
 * exist in the caller's tenant.
 */
export const listCharges = async (customerId: string): Promise<ICustomerCharge[]> => {
  await assertCustomerExists(customerId);

  return CustomerCharge.find({ customerId }).sort({ date: -1, createdAt: -1 });
};

/**
 * Net manual contribution to a customer's outstanding balance:
 *   Σ charges − Σ credits.
 * Returns 0 for an unknown/invalid customer id (callers surface 404 elsewhere).
 */
export const manualBalanceDeltaForCustomer = async (customerId: string): Promise<number> => {
  if (!Types.ObjectId.isValid(customerId)) {
    return 0;
  }

  const rows = await CustomerCharge.aggregate<{ delta: number }>([
    { $match: { customerId: new Types.ObjectId(customerId) } },
    { $group: { _id: null, delta: { $sum: CUSTOMER_CHARGE_SIGNED_DELTA } } }
  ] as PipelineStage[]);

  return rows[0]?.delta ?? 0;
};

/**
 * Net manual contribution per customer as a Map<customerId, delta>.
 * Lets the dashboard/accounts aggregations fold the term in without a second
 * round-trip per customer.
 */
export const manualBalanceByCustomer = async (): Promise<Map<string, number>> => {
  const rows = await CustomerCharge.aggregate<{ _id: Types.ObjectId; delta: number }>([
    { $group: { _id: '$customerId', delta: { $sum: CUSTOMER_CHARGE_SIGNED_DELTA } } }
  ] as PipelineStage[]);

  const byCustomer = new Map<string, number>();
  for (const row of rows) {
    byCustomer.set(String(row._id), row.delta);
  }
  return byCustomer;
};

/** Grand total of the manual balance term across every customer. */
export const manualBalanceTotal = async (): Promise<number> => {
  const rows = await CustomerCharge.aggregate<{ total: number }>([
    { $group: { _id: null, total: { $sum: CUSTOMER_CHARGE_SIGNED_DELTA } } }
  ] as PipelineStage[]);

  return rows[0]?.total ?? 0;
};

/** Throws 404 when the customer does not exist in the active tenant. */
const assertCustomerExists = async (customerId: string): Promise<void> => {
  if (!Types.ObjectId.isValid(customerId)) {
    throw new AppError('Customer not found', 404);
  }

  const exists = await Customer.exists({ _id: customerId });
  if (!exists) {
    throw new AppError('Customer not found', 404);
  }
};
