import { Types, type PipelineStage } from 'mongoose';
import { Order, type IOrder } from '../orders/model.js';
import { Customer } from '../customers/model.js';
import { Payment, type IPayment } from '../payments/model.js';
import { Return, type IReturn } from '../returns/model.js';
import { CustomerCharge } from '../customer-charges/model.js';
import { CUSTOMER_CHARGE_SIGNED_DELTA } from '../customer-charges/service.js';
import { AppError } from '../../middleware/error-handler.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccountRow {
  customerId: string;
  customerName: string;
  type: 'B2B' | 'B2C' | null;
  outstandingBalance: number;
  openOrdersCount: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  hasPendingOrders: boolean;
  lastOrderDate: Date | null;
  totalSpent: number;
  creditLimit: number;
  creditUsedPct: number;
  status: 'active' | 'inactive';
}

export interface AccountListFilters {
  onlyDebtors?: boolean;
  overdueOnly?: boolean;
  search?: string;
  status?: 'active' | 'inactive';
  sort?: 'name' | 'balance' | 'overdue';
  limit: number;
  page: number;
}

export interface AccountListResult {
  items: AccountRow[];
  total: number;
  page: number;
  limit: number;
}

export interface AccountMovement {
  type: 'order' | 'payment' | 'opening' | 'return' | 'charge' | 'credit';
  id: string;
  date: string;
  description: string;
  amount: number;
  sign: '+' | '-';
  method?: string;
  reference?: string | null;
}

export interface AccountSummary {
  outstandingBalance: number;
  openOrdersCount: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  totalSpent: number;
  lastOrderDate: Date | null;
}

export interface AccountMovementsResult {
  customer: {
    _id: string;
    name: string;
    type: 'B2B' | 'B2C';
    status: 'active' | 'inactive';
    creditConfig: { limit: number; termDays: number };
  };
  summary: AccountSummary;
  movements: AccountMovement[];
  orders: { items: IOrder[]; total: number; page: number; limit: number };
  payments: IPayment[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Regex-escapes user-provided search terms so they are matched literally. */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Consolidated account list (GET /accounts) ───────────────────────────────

/**
 * Lists every customer's consolidated account state in one call.
 *
 * Pipeline (mirrors the dashboard "deudas" debt-computation pattern):
 *   1. $match  — only non-cancelled orders
 *   2. $group  — per customer: outstanding balance, open orders count,
 *                overdue amount + max days overdue ($max $dateDiff),
 *                pending-orders flag, last order date, total spent
 *   2b.$unionWith — manual charges (customercharges) + re-group, so charge-only
 *                customers appear with their signed delta
 *   3. $addFields — outstanding = order balance + openingDebt + manual delta
 *   4. $lookup — customers for name/type/status/creditConfig
 *   5. $match  — post-lookup filters (onlyDebtors / overdueOnly / search / status)
 *   6. $sort   — balance desc (default) | name | overdue
 *   7. $facet  — pagination envelope { items, total, page, limit }
 */
export const listAccounts = async (filters: AccountListFilters): Promise<AccountListResult> => {
  const now = new Date();

  // Overdue condition shared by overdueAmount and maxDaysOverdue.
  const overdueCond = {
    $and: [
      { $ne: ['$dueDate', null] },
      { $lt: ['$dueDate', now] },
      { $ne: ['$paymentStatus', 'paid'] }
    ]
  };

  const pipeline: PipelineStage[] = [
    { $match: { status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$customerId',
        // Order-derived balance only — openingDebt is added below after the
        // customer lookup (spec: outstanding = Σ order balances + openingDebt).
        orderOutstanding: { $sum: '$balance' },
        openOrdersCount: {
          $sum: { $cond: [{ $in: ['$paymentStatus', ['unpaid', 'partial']] }, 1, 0] }
        },
        overdueAmount: { $sum: { $cond: [overdueCond, '$balance', 0] } },
        maxDaysOverdue: {
          $max: {
            $cond: [
              overdueCond,
              { $dateDiff: { startDate: '$dueDate', endDate: now, unit: 'day' } },
              0
            ]
          }
        },
        hasPendingOrders: {
          $max: { $cond: [{ $in: ['$status', ['pending', 'assigned']] }, true, false] }
        },
        lastOrderDate: { $max: '$createdAt' },
        totalSpent: { $sum: '$totalAmount' },
        fallbackName: { $first: '$customerName' }
      }
    },
    // Manual charges: union in the signed per-customer delta so a customer with
    // ONLY manual charges (no orders) still produces an account row.
    {
      $unionWith: {
        coll: 'customercharges',
        pipeline: [
          { $group: { _id: '$customerId', manualDelta: { $sum: CUSTOMER_CHARGE_SIGNED_DELTA } } }
        ]
      }
    } as PipelineStage,
    {
      // Merge order + charge branches per customer (defaults keep the
      // charge-only row consistent: 0 orders, no overdue, no spend).
      $group: {
        _id: '$_id',
        orderOutstanding: { $sum: { $ifNull: ['$orderOutstanding', 0] } },
        manualDelta: { $sum: { $ifNull: ['$manualDelta', 0] } },
        openOrdersCount: { $sum: { $ifNull: ['$openOrdersCount', 0] } },
        overdueAmount: { $sum: { $ifNull: ['$overdueAmount', 0] } },
        maxDaysOverdue: { $max: { $ifNull: ['$maxDaysOverdue', 0] } },
        hasPendingOrders: { $max: { $ifNull: ['$hasPendingOrders', false] } },
        lastOrderDate: { $max: '$lastOrderDate' },
        totalSpent: { $sum: { $ifNull: ['$totalSpent', 0] } },
        fallbackName: { $first: '$fallbackName' }
      }
    },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        // Fold the punto-cero opening debt AND the net manual charges into the
        // outstanding balance (single term each — no double counting).
        outstandingBalance: {
          $add: [
            '$orderOutstanding',
            { $ifNull: ['$customer.openingDebt', 0] },
            '$manualDelta'
          ]
        },
        creditLimit: { $ifNull: ['$customer.creditConfig.limit', 0] },
        creditUsedPct: {
          $cond: [
            {
              $and: [
                { $gt: [{ $ifNull: ['$customer.creditConfig.limit', 0] }, 0] },
                { $gt: ['$outstandingBalance', 0] }
              ]
            },
            {
              $round: [
                {
                  $multiply: [
                    { $divide: ['$outstandingBalance', { $ifNull: ['$customer.creditConfig.limit', 0] }] },
                    100
                  ]
                },
                0
              ]
            },
            0
          ]
        }
      }
    }
  ];

  // Post-lookup filters (fields computed by $group / $addFields).
  const matchAfter: Record<string, unknown> = {};
  if (filters.onlyDebtors) matchAfter.outstandingBalance = { $gt: 0 };
  if (filters.overdueOnly) matchAfter.overdueAmount = { $gt: 0 };
  if (filters.status) matchAfter['customer.status'] = filters.status;
  if (filters.search) {
    matchAfter['customer.name'] = { $regex: escapeRegex(filters.search), $options: 'i' };
  }
  if (Object.keys(matchAfter).length > 0) {
    pipeline.push({ $match: matchAfter } as PipelineStage);
  }

  // Sort: default balance desc; name asc / overdue desc are opt-in.
  const sortSpec: Record<string, 1 | -1> =
    filters.sort === 'name'
      ? { 'customer.name': 1 }
      : filters.sort === 'overdue'
        ? { overdueAmount: -1 }
        : { outstandingBalance: -1 };
  pipeline.push({ $sort: sortSpec } as PipelineStage);

  // Pagination in a single pass via $facet.
  const limit = Math.min(Math.max(filters.limit, 1), 200);
  const skip = (filters.page - 1) * limit;
  pipeline.push({
    $facet: {
      items: [{ $skip: skip }, { $limit: limit }],
      total: [{ $count: 'count' }]
    }
  } as PipelineStage);

  const result = await Order.aggregate(pipeline);
  const facet = result[0] as
    | { items: Array<Record<string, unknown>>; total: Array<{ count: number }> }
    | undefined;

  const items: AccountRow[] = (facet?.items ?? []).map((row) => {
    const customer = (row.customer ?? null) as {
      name?: string;
      type?: 'B2B' | 'B2C';
      status?: 'active' | 'inactive';
    } | null;
    return {
      customerId: String(row._id),
      customerName: customer?.name ?? (row.fallbackName as string),
      type: customer?.type ?? null,
      outstandingBalance: round2(row.outstandingBalance as number),
      openOrdersCount: row.openOrdersCount as number,
      overdueAmount: round2(row.overdueAmount as number),
      maxDaysOverdue: row.maxDaysOverdue as number,
      hasPendingOrders: Boolean(row.hasPendingOrders),
      lastOrderDate: (row.lastOrderDate as Date | null) ?? null,
      totalSpent: round2(row.totalSpent as number),
      creditLimit: row.creditLimit as number,
      creditUsedPct: row.creditUsedPct as number,
      status: customer?.status ?? 'active'
    };
  });

  return {
    items,
    total: facet?.total[0]?.count ?? 0,
    page: filters.page,
    limit
  };
};

// ─── Account ledger (GET /accounts/:customerId/movements) ────────────────────

/**
 * Account ledger for one customer: chronologically merged order + payment
 * movements (newest first), a consolidated summary, the open (unpaid/partial)
 * orders and the recent payments.
 *
 * NOTE on the summary: balances are computed over NON-CANCELLED orders only
 * (spec: "sum of balances across non-cancelled orders"). The shared
 * getCustomerOutstanding helper now filters cancelled orders and includes
 * openingDebt, but the figures here are still computed locally so the ledger
 * can build the opening movement alongside them.
 */
export const getAccountMovements = async (
  customerId: string,
  ordersFilters: { limit: number; page: number }
): Promise<AccountMovementsResult> => {
  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const now = new Date();

  // Non-cancelled orders — the ledger source. Sorted createdAt desc so the
  // first row is the most recent (drives lastOrderDate).
  const [orders, overdueAgg] = await Promise.all([
    Order.find({ customerId, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }),
    Order.aggregate([
      {
        $match: {
          customerId: new Types.ObjectId(customerId),
          status: { $ne: 'cancelled' },
          dueDate: { $ne: null, $lt: now },
          paymentStatus: { $ne: 'paid' }
        }
      },
      {
        $group: {
          _id: null,
          overdueAmount: { $sum: '$balance' },
          maxDaysOverdue: {
            $max: { $dateDiff: { startDate: '$dueDate', endDate: now, unit: 'day' } }
          }
        }
      }
    ])
  ]);

  const overdue = overdueAgg[0] as { overdueAmount?: number; maxDaysOverdue?: number } | undefined;

  // Manual charges/credits for this customer (ledger source + balance term).
  const charges = await CustomerCharge.find({ customerId }).sort({ date: 1, createdAt: 1 });
  const manualDelta = charges.reduce(
    (sum, charge) => sum + (charge.type === 'charge' ? charge.amount : -charge.amount),
    0
  );

  // Consolidated summary (non-cancelled orders + punto-cero opening debt +
  // net manual charges).
  const openingDebt = customer.openingDebt ?? 0;
  const outstandingBalance = round2(
    orders.reduce((sum, order) => sum + order.balance, 0) + openingDebt + manualDelta
  );
  const totalSpent = round2(orders.reduce((sum, order) => sum + order.totalAmount, 0));
  const openOrdersCount = orders.filter((order) => order.paymentStatus !== 'paid').length;
  const lastOrderDate = orders[0]?.createdAt ?? null;

  // Payments across this customer's non-cancelled orders (ledger source).
  const payments = await Payment.find({ orderId: { $in: orders.map((o) => o._id) } }).sort({
    date: -1,
    createdAt: -1
  });

  // Returns across the same orders — each becomes a 'return' ledger movement.
  const returns = await Return.find({ orderId: { $in: orders.map((o) => o._id) } }).sort({
    date: 1,
    createdAt: 1
  });
  const returnsByOrder = new Map<string, IReturn[]>();
  for (const returnDoc of returns) {
    const key = returnDoc.orderId.toString();
    const list = returnsByOrder.get(key) ?? [];
    list.push(returnDoc);
    returnsByOrder.set(key, list);
  }

  // Chronologically merged ledger — newest first. The opening debt entry is
  // dated at customer creation (the debt existed before any order).
  const movements: AccountMovement[] = [
    ...(openingDebt > 0
      ? [
          {
            type: 'opening' as const,
            id: `opening-${customer._id.toString()}`,
            date: customer.createdAt.toISOString(),
            description: 'Deuda inicial',
            amount: openingDebt,
            sign: '+' as const
          }
        ]
      : []),
    ...orders.flatMap((order) => {
      const orderReturns = returnsByOrder.get(order._id.toString()) ?? [];
      return [
        {
          type: 'order' as const,
          id: order._id.toString(),
          date: order.createdAt.toISOString(),
          description: `Pedido #${order.orderNumber}`,
          amount: order.totalAmount,
          sign: '+' as const,
          method: order.paymentPreference ?? 'cash',
          reference: null
        },
        ...orderReturns.map((returnDoc) => ({
          type: 'return' as const,
          id: returnDoc._id.toString(),
          date: returnDoc.date.toISOString(),
          description: `Devolución #${order.orderNumber}`,
          amount: returnDoc.returnedAmount,
          sign: '-' as const,
          reference: null
        }))
      ];
    }),
    ...payments.map((payment) => {
      const order = orders.find((o) => o._id.toString() === payment.orderId.toString());
      return {
        type: 'payment' as const,
        id: payment._id.toString(),
        date: payment.date.toISOString(),
        description: order ? `Pago a Pedido #${order.orderNumber}` : 'Pago',
        amount: payment.amount,
        sign: '-' as const,
        method: payment.method,
        reference: payment.reference ?? null
      };
    }),
    // Manual charges/credits — each becomes a ledger movement. Charges add to
    // what the customer owes ('+'); credits reduce it ('-').
    ...charges.map((charge) => {
      const isCharge = charge.type === 'charge';
      return {
        type: isCharge ? ('charge' as const) : ('credit' as const),
        id: charge._id.toString(),
        date: charge.date.toISOString(),
        description: isCharge ? 'Deuda manual' : 'Crédito',
        amount: charge.amount,
        sign: isCharge ? ('+' as const) : ('-' as const),
        reference: charge.note ?? null
      };
    })
  ].sort((a, b) => b.date.localeCompare(a.date));

  // Open orders — paginated unpaid/partial list with balance.
  const limit = Math.min(Math.max(ordersFilters.limit, 1), 200);
  const skip = (ordersFilters.page - 1) * limit;
  const openQuery = {
    customerId,
    status: { $ne: 'cancelled' },
    paymentStatus: { $in: ['unpaid', 'partial'] }
  };
  const [openItems, openTotal] = await Promise.all([
    Order.find(openQuery).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(openQuery)
  ]);

  return {
    customer: {
      _id: customer._id.toString(),
      name: customer.name,
      type: customer.type,
      status: customer.status,
      creditConfig: customer.creditConfig
    },
    summary: {
      outstandingBalance,
      openOrdersCount,
      overdueAmount: round2(overdue?.overdueAmount ?? 0),
      maxDaysOverdue: overdue?.maxDaysOverdue ?? 0,
      totalSpent,
      lastOrderDate
    },
    movements,
    orders: { items: openItems, total: openTotal, page: ordersFilters.page, limit },
    payments
  };
};