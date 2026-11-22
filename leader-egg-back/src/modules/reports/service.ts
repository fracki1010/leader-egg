import { Types, type PipelineStage } from 'mongoose';
import { Order } from '../orders/model.js';
import { Customer } from '../customers/model.js';
import { Expense } from '../expenses/model.js';
import { Payment } from '../payments/model.js';
import { Return } from '../returns/model.js';
import { CUSTOMER_CHARGE_SIGNED_DELTA } from '../customer-charges/service.js';
import { AppError } from '../../middleware/error-handler.js';

// ─── Revenue report types ────────────────────────────────────────────────────

export interface RevenueBreakdownByProduct {
  productId: string;
  productName: string;
  total: number;
  quantity: number;
}

export interface RevenueBreakdownByCustomer {
  customerId: string;
  customerName: string;
  total: number;
  orderCount: number;
}

export interface RevenueBreakdownByPaymentMethod {
  method: string;
  total: number;
}

export interface RevenueBreakdownByChannel {
  canal: string;
  monto: number;
  ordenes: number;
}

export interface RevenueReport {
  totalRevenue: number;
  orderCount: number;
  startDate: string;
  endDate: string;
  breakdown: {
    byProduct: RevenueBreakdownByProduct[];
    byCustomer: RevenueBreakdownByCustomer[];
    byPaymentMethod: RevenueBreakdownByPaymentMethod[];
    byChannel: RevenueBreakdownByChannel[];
  };
}

// ─── Profit report types ─────────────────────────────────────────────────────

/**
 * Profit for a single calendar day in BUSINESS_TIMEZONE.
 * Days with no orders and no expenses are omitted from the report.
 */
export interface ProfitByDay {
  date: string; // 'YYYY-MM-DD' in BUSINESS_TIMEZONE
  revenue: number;
  /** Money already collected that day (Σ paidAmount). */
  collected: number;
  /** Money still owed that day (Σ balance). */
  pendingCollection: number;
  cogs: number;
  expenses: number;
  profit: number;
  margin: number;
  orderCount: number;
}

export interface ProfitReport {
  /** Accrual revenue: Σ totalAmount of delivered orders, paid or not. */
  revenue: number;
  /** Money already collected on those orders (Σ paidAmount). */
  collected: number;
  /** Money still owed on those orders (Σ balance). */
  pendingCollection: number;
  cogs: number;
  expenses: number;
  profit: number;
  margin: number;
  partialCOGS: boolean;
  disclaimer?: string;
  byDay: ProfitByDay[];
  /**
   * Cash-basis result for the SAME period, driven by MOVEMENT dates (payments
   * and cash refunds) instead of the sale date. Additive: the accrual fields
   * above keep their exact meaning.
   */
  cashBasis: CashBasisReport;
  /**
   * GLOBAL receivable position (not period-scoped): how much the business still
   * has to collect, split into overdue / upcoming.
   */
  receivable: ReceivableSummary;
}

/**
 * Cash-basis profit for a single BUSINESS_TIMEZONE calendar day.
 * Days with no cash movement (payments or refunds) are omitted.
 */
export interface CashBasisByDay {
  date: string; // 'YYYY-MM-DD' in BUSINESS_TIMEZONE
  /** Σ Payment.amount received that day (gross collections). */
  collected: number;
  /** Σ cash refunds that day (Return.refundAmount > 0). */
  refunded: number;
  /** Proportional cost of the net collected amount. */
  cogs: number;
  /** collected − refunded − cogs. */
  profit: number;
  /** profit / collected × 100, one decimal, 0 when collected = 0. */
  margin: number;
}

export interface CashBasisReport {
  collected: number;
  refunded: number;
  cogs: number;
  profit: number;
  margin: number;
  /** Descending by date; days with no movement omitted. */
  byDay: CashBasisByDay[];
}

/**
 * Canonical "how much do I still have to collect" summary, matching the
 * dashboard's `porCobrar` / `clientesDeudores` formulas exactly.
 */
export interface ReceivableSummary {
  /** Canonical total debt: Σ non-cancelled order balances + openingDebt + net manual charges. */
  total: number;
  /** Non-cancelled orders with dueDate < now and paymentStatus != paid. */
  overdue: number;
  /** total − overdue (opening debt + manual charges carry no due date). */
  upcoming: number;
  /** Customers whose NET debt is > 0. */
  customerCount: number;
}
// ─── Customer history types ──────────────────────────────────────────────────

export interface CustomerHistory {
  customerId: string;
  customerName: string;
  orders: Array<{
    _id: string;
    orderNumber: string;
    totalAmount: number;
    status: string;
    paymentStatus: string;
    createdAt: Date;
    /** Business/sale date (falls back to createdAt on legacy docs). */
    orderDate: Date;
  }>;
  totalSpent: number;
  orderCount: number;
  avgOrderValue: number;
  lastPurchaseDate: Date | null;
}

// ─── Customer frequency types ────────────────────────────────────────────────

export interface FrequencyPeriod {
  period: string;
  count: number;
}

export interface CustomerFrequency {
  customerId: string;
  period: 'weekly' | 'monthly';
  periods: FrequencyPeriod[];
}

// ─── Top customers types ─────────────────────────────────────────────────────

export interface TopCustomer {
  customerId: string;
  customerName: string;
  totalRevenue: number;
  orderCount: number;
}

// ─── Aging report types ─────────────────────────────────────────────────────

export type AgingBucketLabel = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  label: AgingBucketLabel;
  count: number;
  totalAmount: number;
}

export interface AgingReport {
  buckets: AgingBucket[];
  totalOverdue: number;
}

export interface CustomerAgingReport extends AgingReport {
  customerId: string;
  oldestDueDate: Date | null;
}

// ─── Bucket boundary mapping ────────────────────────────────────────────────

const BOUNDARY_LABELS: Record<string, AgingBucketLabel> = {
  current: 'current',
  '-Infinity': 'current',
  '0': 'current',
  '1': '1-30',
  '31': '31-60',
  '61': '61-90',
  '91': '90+'
};

const labelToBucket = (label: AgingBucketLabel): AgingBucket => ({
  label,
  count: 0,
  totalAmount: 0
});

/**
 * Maps a $bucket boundary ID to a human-readable aging bucket label.
 */
const resolveLabel = (boundaryId: unknown): AgingBucketLabel => {
  if (boundaryId === 'current') return 'current';
  const key = String(boundaryId);
  return BOUNDARY_LABELS[key] ?? '90+';
};

// ─── Aging report ───────────────────────────────────────────────────────────

/**
 * Generates an aging report by bucketing overdue orders.
 * Uses MongoDB aggregation pipeline with $dateDiff and $bucket.
 *
 * NOTE: aging stays strictly ORDER-based. Manual customer charges
 * (customer-charges module) have no due date, so they cannot be bucketed by
 * days overdue and are intentionally EXCLUDED here — folding them into a
 * bucket would silently change aging semantics. They still count toward the
 * customer's outstanding balance everywhere else (accounts, dashboard).
 *
 * @param customerId - Optional customer filter
 * @returns Aging report with bucket breakdown and total overdue
 */
export const getAgingReport = async (customerId?: string): Promise<AgingReport | CustomerAgingReport> => {
  const now = new Date();

  const matchStage: Record<string, unknown> = {
    paymentStatus: { $ne: 'paid' },
    dueDate: { $ne: null }
  };

  if (customerId) {
    matchStage.customerId = new Types.ObjectId(customerId);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        daysOverdue: {
          $dateDiff: { startDate: '$dueDate', endDate: now, unit: 'day' }
        }
      }
    },
    {
      $bucket: {
        groupBy: '$daysOverdue',
        boundaries: [-Infinity, 0, 1, 31, 61, 91],
        default: '91',
        output: {
          count: { $sum: 1 },
          totalAmount: { $sum: '$balance' }
        }
      }
    }
  ];

  const results = await Order.aggregate(pipeline);

  // Initialize all buckets with zeros
  const bucketMap = new Map<AgingBucketLabel, AgingBucket>([
    ['current', labelToBucket('current')],
    ['1-30', labelToBucket('1-30')],
    ['31-60', labelToBucket('31-60')],
    ['61-90', labelToBucket('61-90')],
    ['90+', labelToBucket('90+')]
  ]);

  // Fill from aggregation results
  for (const row of results) {
    const label = resolveLabel(row._id);
    const bucket = bucketMap.get(label);
    if (bucket) {
      bucket.count = row.count as number;
      bucket.totalAmount = row.totalAmount as number;
    }
  }

  const buckets = Array.from(bucketMap.values());

  // totalOverdue = sum of all past-due buckets (excludes "current")
  const totalOverdue = buckets
    .filter(b => b.label !== 'current')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  if (customerId) {
    // Find oldest due date for this customer
    const oldest = await Order.findOne(
      { customerId: new Types.ObjectId(customerId), paymentStatus: { $ne: 'paid' }, dueDate: { $ne: null } },
      { dueDate: 1 }
    ).sort({ dueDate: 1 });

    return {
      buckets,
      totalOverdue,
      customerId,
      oldestDueDate: oldest?.dueDate ?? null
    };
  }

  return { buckets, totalOverdue };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Business timezone for report date boundaries (Argentina Time).
 * ART is a fixed UTC-3 offset all year round — there is no DST, so a literal
 * `-03:00` suffix is safe and keeps the intent explicit.
 */
const BUSINESS_TIMEZONE = 'America/Argentina/Buenos_Aires';
const BUSINESS_UTC_OFFSET = '-03:00';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses one boundary of a report date range.
 *
 * - Date-only values (`YYYY-MM-DD`) are interpreted as calendar dates IN
 *   BUSINESS_TIMEZONE. The end boundary is inclusive: 23:59:59.999 ART.
 * - Full ISO instants (anything carrying a `T`) are parsed as absolute
 *   instants for backwards compatibility — no local-time adjustments.
 */
const parseDateBoundary = (value: string, isEnd: boolean): Date => {
  if (DATE_ONLY_PATTERN.test(value)) {
    const time = isEnd ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${value}T${time}${BUSINESS_UTC_OFFSET}`);
  }
  return new Date(value);
};

const parseDateRange = (startDate: string | undefined, endDate: string | undefined): { start: Date; end: Date } => {
  if (!startDate || !endDate) {
    throw new AppError('startDate and endDate are required', 400);
  }
  const start = parseDateBoundary(startDate, false);
  const end = parseDateBoundary(endDate, true);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError('Invalid date format', 400);
  }
  if (start > end) {
    throw new AppError('startDate must be <= endDate', 400);
  }
  return { start, end };
};

// ─── Revenue report ──────────────────────────────────────────────────────────

/**
 * Matches orders whose BUSINESS date (`orderDate`) falls inside [start, end].
 * Legacy docs created before the field existed fall back to `createdAt` so
 * historical reports keep working until the backfill runs.
 */
const orderDateRangeMatch = (start: Date, end: Date): Record<string, unknown> => ({
  $or: [
    { orderDate: { $gte: start, $lte: end } },
    { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }
  ]
});

/**
 * Calculates total revenue from delivered orders within a date range.
 * Includes breakdowns by product, customer, and payment method.
 */
export const getRevenueReport = async (startDate: string, endDate: string): Promise<RevenueReport> => {
  const { start, end } = parseDateRange(startDate, endDate);

  // 1. Total revenue + order count from delivered orders
  const revenuePipeline = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        orderCount: { $sum: 1 }
      }
    }
  ];
  const revenueResult = await Order.aggregate(revenuePipeline);
  const totalRevenue = revenueResult[0]?.totalRevenue ?? 0;
  const orderCount = revenueResult[0]?.orderCount ?? 0;

  // 2. Breakdown by product (unwind items)
  const byProductPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        productName: { $first: '$items.productName' },
        total: { $sum: '$items.subtotal' },
        quantity: { $sum: '$items.quantity' }
      }
    },
    { $sort: { total: -1 } }
  ];
  const byProductRaw = await Order.aggregate(byProductPipeline);
  const byProduct: RevenueBreakdownByProduct[] = byProductRaw.map((r: Record<string, unknown>) => ({
    productId: (r._id as Types.ObjectId).toString(),
    productName: r.productName as string,
    total: r.total as number,
    quantity: r.quantity as number
  }));

  // 3. Breakdown by customer
  const byCustomerPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    {
      $group: {
        _id: '$customerId',
        customerName: { $first: '$customerName' },
        total: { $sum: '$totalAmount' },
        orderCount: { $sum: 1 }
      }
    },
    { $sort: { total: -1 } }
  ];
  const byCustomerRaw = await Order.aggregate(byCustomerPipeline);
  const byCustomer: RevenueBreakdownByCustomer[] = byCustomerRaw.map((r: Record<string, unknown>) => ({
    customerId: (r._id as Types.ObjectId).toString(),
    customerName: r.customerName as string,
    total: r.total as number,
    orderCount: r.orderCount as number
  }));

  // 4. Breakdown by payment method (via $lookup to payments)
  const byPaymentPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    {
      $lookup: {
        from: 'payments',
        localField: '_id',
        foreignField: 'orderId',
        as: 'payments'
      }
    },
    { $unwind: '$payments' },
    {
      $group: {
        _id: '$payments.method',
        total: { $sum: '$payments.amount' }
      }
    },
    { $sort: { total: -1 } }
  ];
  const byPaymentRaw = await Order.aggregate(byPaymentPipeline);
  const byPaymentMethod: RevenueBreakdownByPaymentMethod[] = byPaymentRaw.map((r: Record<string, unknown>) => ({
    method: r._id as string,
    total: r.total as number
  }));

  // 5. Breakdown by sales channel — legacy orders without the field group as 'reparto'
  const byChannelPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    {
      $group: {
        _id: { $ifNull: ['$salesChannel', 'reparto'] },
        monto: { $sum: '$totalAmount' },
        ordenes: { $sum: 1 }
      }
    },
    { $sort: { monto: -1 } }
  ];
  const byChannelRaw = await Order.aggregate(byChannelPipeline);
  const byChannel: RevenueBreakdownByChannel[] = byChannelRaw.map((r: Record<string, unknown>) => ({
    canal: r._id as string,
    monto: round2(r.monto as number),
    ordenes: r.ordenes as number
  }));

  return {
    totalRevenue,
    orderCount,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    breakdown: { byProduct, byCustomer, byPaymentMethod, byChannel }
  };
};

// ─── Profit report ───────────────────────────────────────────────────────────

/**
 * Mongo expression computing an order's COGS with the SAME rule as the accrual
 * report: Σ (mapleQty ?? quantity) × product.costPrice, missing/null cost = 0.
 *
 * Requires `$order` (the joined order) and `$productDocs` (the joined products)
 * in the current document. Used to derive the proportional cost of a payment or
 * a cash refund without ever duplicating the cost rule.
 */
const ORDER_COGS_EXPRESSION: Record<string, unknown> = {
  $reduce: {
    input: { $ifNull: ['$order.items', []] },
    initialValue: 0,
    in: {
      $let: {
        vars: {
          product: {
            $arrayElemAt: [
              {
                $filter: {
                  input: { $ifNull: ['$productDocs', []] },
                  as: 'candidate',
                  cond: { $eq: ['$$candidate._id', '$$this.productId'] }
                }
              },
              0
            ]
          }
        },
        in: {
          $add: [
            '$$value',
            {
              $cond: [
                // Same explicit type guard as the accrual COGS: null/missing cost = 0.
                { $in: [{ $type: '$$product.costPrice' }, ['double', 'int', 'long', 'decimal']] },
                {
                  $multiply: [
                    // costPrice is PER MAPLE — use the maple-equivalent quantity.
                    { $ifNull: ['$$this.mapleQty', '$$this.quantity'] },
                    '$$product.costPrice'
                  ]
                },
                0
              ]
            }
          ]
        }
      }
    }
  }
};

/** Proportional cost expression: movementAmount × orderCogs / order.totalAmount. */
const proportionalCogsExpression = (amountExpression: string): Record<string, unknown> => ({
  $let: {
    vars: { orderCogs: ORDER_COGS_EXPRESSION },
    in: {
      $cond: [
        { $gt: ['$order.totalAmount', 0] },
        { $multiply: [amountExpression, { $divide: ['$$orderCogs', '$order.totalAmount'] }] },
        0
      ]
    }
  }
});

/**
 * Cash-basis profit for the period, driven by MOVEMENT dates.
 *
 * - Payments: `Payment.date` in [start, end], joined to an order that is
 *   `status: 'delivered'` (cancelled/undelivered sales contribute no cash
 *   profit). Each payment's cost is `amount × orderCogs / order.totalAmount`.
 * - Refunds: `Return.date` in [start, end] with `refundAmount > 0`, joined to
 *   the same delivered order; they reduce `collected` (tracked as `refunded`)
 *   AND the proportional cost by `refundAmount × orderCogs / order.totalAmount`.
 *   Only CASH refunds move money here — a store credit (`creditIssued`) is not
 *   cash and has `refundAmount = 0`, so it is naturally excluded.
 *
 * `profit = collected − refunded − cogs` and per-day rows sum to the totals.
 */
const getCashBasisReport = async (start: Date, end: Date): Promise<CashBasisReport> => {
  const dayExpression = {
    $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: BUSINESS_TIMEZONE }
  };

  const [paymentRows, refundRows] = await Promise.all([
    Payment.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order'
        }
      },
      { $unwind: '$order' },
      { $match: { 'order.status': 'delivered' } },
      {
        $lookup: {
          from: 'products',
          localField: 'order.items.productId',
          foreignField: '_id',
          as: 'productDocs'
        }
      },
      {
        $project: {
          _id: 0,
          day: dayExpression,
          amount: '$amount',
          cogs: proportionalCogsExpression('$amount')
        }
      }
    ]),
    Return.aggregate([
      { $match: { date: { $gte: start, $lte: end }, refundAmount: { $gt: 0 } } },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order'
        }
      },
      { $unwind: '$order' },
      { $match: { 'order.status': 'delivered' } },
      {
        $lookup: {
          from: 'products',
          localField: 'order.items.productId',
          foreignField: '_id',
          as: 'productDocs'
        }
      },
      {
        $project: {
          _id: 0,
          day: dayExpression,
          amount: '$refundAmount',
          cogs: proportionalCogsExpression('$refundAmount')
        }
      }
    ])
  ]);

  interface CashDayAccumulator {
    collected: number;
    refunded: number;
    cogs: number;
  }

  const dayMap = new Map<string, CashDayAccumulator>();
  const dayEntry = (date: string): CashDayAccumulator => {
    const existing = dayMap.get(date);
    if (existing) return existing;
    const created: CashDayAccumulator = { collected: 0, refunded: 0, cogs: 0 };
    dayMap.set(date, created);
    return created;
  };

  for (const row of paymentRows as Array<Record<string, unknown>>) {
    const day = dayEntry(row.day as string);
    day.collected += (row.amount as number) ?? 0;
    day.cogs += (row.cogs as number) ?? 0;
  }
  for (const row of refundRows as Array<Record<string, unknown>>) {
    const day = dayEntry(row.day as string);
    day.refunded += (row.amount as number) ?? 0;
    day.cogs -= (row.cogs as number) ?? 0;
  }

  const byDay: CashBasisByDay[] = Array.from(dayMap.entries())
    .map(([date, day]) => {
      const collected = round2(day.collected);
      const refunded = round2(day.refunded);
      // A refund releases the proportional cost. On a refund-only day this can
      // be negative — that is correct and keeps day totals addable.
      const cogs = round2(day.cogs);
      const profit = round2(collected - refunded - cogs);
      const margin = collected > 0 ? Math.round((profit / collected) * 1000) / 10 : 0;
      return { date, collected, refunded, cogs, profit, margin };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Totals derive from the rounded per-day rows so the days always add up.
  const collected = round2(byDay.reduce((sum, day) => sum + day.collected, 0));
  const refunded = round2(byDay.reduce((sum, day) => sum + day.refunded, 0));
  // Cogs is non-negative in practice; round2 already collapses float noise to
  // 0 and `+ 0` normalizes a possible -0.
  const cogs = round2(byDay.reduce((sum, day) => sum + day.cogs, 0)) + 0;
  const profit = round2(collected - refunded - cogs);
  const margin = collected > 0 ? Math.round((profit / collected) * 1000) / 10 : 0;

  return { collected, refunded, cogs, profit, margin, byDay };
};

/**
 * Global receivable position. Mirrors the dashboard's `deudas` pipeline
 * (orders + $unionWith customercharges + $unionWith customers with
 * openingDebt > 0) so `total` matches `porCobrar` and `customerCount` matches
 * `clientesDeudores` by construction.
 *
 * The per-customer net is the canonical debt term:
 *   Σ order balances + Customer.openingDebt + (Σ charges − Σ credits).
 */
const getReceivableSummary = async (): Promise<ReceivableSummary> => {
  const now = new Date();

  const [debtRows, overdueResult] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' }, balance: { $gt: 0 } } },
      { $group: { _id: '$customerId', orderDebt: { $sum: '$balance' } } },
      // Manual charges: charge-only customers enter here with their signed delta.
      {
        $unionWith: {
          coll: 'customercharges',
          pipeline: [
            { $group: { _id: '$customerId', manualDelta: { $sum: CUSTOMER_CHARGE_SIGNED_DELTA } } }
          ]
        }
      } as PipelineStage,
      // Opening-debt (punto cero) customers enter here, exactly once each.
      {
        $unionWith: {
          coll: 'customers',
          pipeline: [
            { $match: { openingDebt: { $gt: 0 } } },
            { $project: { _id: 1, openingDebt: 1 } }
          ]
        }
      } as PipelineStage,
      {
        $group: {
          _id: '$_id',
          orderDebt: { $sum: { $ifNull: ['$orderDebt', 0] } },
          manualDelta: { $sum: { $ifNull: ['$manualDelta', 0] } },
          openingDebt: { $sum: { $ifNull: ['$openingDebt', 0] } }
        }
      },
      { $addFields: { totalDebt: { $add: ['$orderDebt', '$manualDelta', '$openingDebt'] } } }
    ]),
    // Overdue: non-cancelled orders past due and not fully paid (dashboard vencidas).
    Order.aggregate([
      {
        $match: {
          dueDate: { $ne: null, $lt: now },
          paymentStatus: { $ne: 'paid' },
          status: { $ne: 'cancelled' }
        }
      },
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ])
  ]);

  const totalDebt = (debtRows as Array<Record<string, unknown>>).map((row) => (row.totalDebt as number) ?? 0);
  const total = round2(totalDebt.reduce((sum, value) => sum + value, 0));
  const customerCount = totalDebt.filter((value) => value > 0).length;
  const overdue = round2((overdueResult[0]?.total as number) ?? 0);

  return {
    total,
    overdue,
    upcoming: round2(total - overdue),
    customerCount
  };
};

/**
 * Calculates profit = revenue - COGS - expenses.
 * COGS = sum of (product.costPrice × mapleQty) for items where costPrice is not null.
 * `costPrice` is stored PER MAPLE (see the "Costo por maple" product field and
 * `src/lib/margin.ts`), so the line's unit quantity must be converted to maples
 * first. Using `items.quantity` would understate COGS for cajón / medio cajón
 * lines by the unit's maple equivalence.
 * Items with null costPrice are excluded from COGS with a disclaimer.
 */
export const getProfitReport = async (startDate: string, endDate: string): Promise<ProfitReport> => {
  const { start, end } = parseDateRange(startDate, endDate);

  // 1. Revenue from delivered orders.
  //
  // `revenue` is ACCRUAL revenue: the full billed amount (Σ totalAmount) of
  // delivered orders, regardless of whether the customer has paid yet. The
  // collection split (`collected` = Σ paidAmount, `pendingCollection` =
  // Σ balance) answers "how much of that revenue is already in?" without
  // changing the accounting basis.
  //
  // IMPORTANT: `collected + pendingCollection` can be LOWER than `revenue` when
  // the order had returns. A return reduces `paidAmount`/`balance` without
  // reducing `totalAmount`, so the difference is expected accounting, NOT a bug.
  const revenuePipeline = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$totalAmount' },
        collected: { $sum: '$paidAmount' },
        pendingCollection: { $sum: '$balance' }
      }
    }
  ];
  const revenueResult = await Order.aggregate(revenuePipeline);
  const revenue = revenueResult[0]?.revenue ?? 0;
  const collected = round2(revenueResult[0]?.collected ?? 0);
  const pendingCollection = round2(revenueResult[0]?.pendingCollection ?? 0);

  // 2. COGS — need to join order items with products to get costPrice
  const cogsPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'productInfo'
      }
    },
    { $unwind: '$productInfo' },
    {
      $group: {
        _id: null,
        totalCogs: {
          $sum: {
            $cond: [
              // Explicit type check: a missing or null costPrice counts as 0,
              // so it can never leak into a numeric expression as NaN.
              {
                $in: [
                  { $type: '$productInfo.costPrice' },
                  ['double', 'int', 'long', 'decimal']
                ]
              },
              // costPrice is per maple — use the maple-equivalent quantity.
              // Legacy items without mapleQty fall back to their unit quantity.
              { $multiply: [{ $ifNull: ['$items.mapleQty', '$items.quantity'] }, '$productInfo.costPrice'] },
              0
            ]
          }
        },
        hasNullCostPrice: {
          $sum: {
            $cond: [{ $eq: ['$productInfo.costPrice', null] }, 1, 0]
          }
        }
      }
    }
  ];
  const cogsResult = await Order.aggregate(cogsPipeline);
  const cogs = cogsResult[0]?.totalCogs ?? 0;
  const nullCostPriceCount = cogsResult[0]?.hasNullCostPrice ?? 0;

  // 3. Expenses in the same period
  const expensesPipeline = [
    { $match: { date: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ];
  const expensesResult = await Expense.aggregate(expensesPipeline);
  const expenses = expensesResult[0]?.total ?? 0;

  // 4. Per-day breakdown — calendar days in BUSINESS_TIMEZONE.
  // Days with no delivered orders and no expenses are omitted entirely.
  const revenueByDayPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: { $ifNull: ['$orderDate', '$createdAt'] }, timezone: BUSINESS_TIMEZONE }
        },
        revenue: { $sum: '$totalAmount' },
        collected: { $sum: '$paidAmount' },
        pendingCollection: { $sum: '$balance' },
        orderCount: { $sum: 1 }
      }
    }
  ];
  const revenueByDayRaw = await Order.aggregate(revenueByDayPipeline);

  const cogsByDayPipeline: PipelineStage[] = [
    { $match: { status: 'delivered', ...orderDateRangeMatch(start, end) } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'productInfo'
      }
    },
    { $unwind: '$productInfo' },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: { $ifNull: ['$orderDate', '$createdAt'] }, timezone: BUSINESS_TIMEZONE }
        },
        cogs: {
          $sum: {
            $cond: [
              // Explicit type check: a missing or null costPrice counts as 0,
              // so it can never leak into a numeric expression as NaN.
              {
                $in: [
                  { $type: '$productInfo.costPrice' },
                  ['double', 'int', 'long', 'decimal']
                ]
              },
              // costPrice is per maple — use the maple-equivalent quantity.
              // Legacy items without mapleQty fall back to their unit quantity.
              { $multiply: [{ $ifNull: ['$items.mapleQty', '$items.quantity'] }, '$productInfo.costPrice'] },
              0
            ]
          }
        }
      }
    }
  ];
  const cogsByDayRaw = await Order.aggregate(cogsByDayPipeline);

  const expensesByDayPipeline: PipelineStage[] = [
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: BUSINESS_TIMEZONE }
        },
        expenses: { $sum: '$amount' }
      }
    }
  ];
  const expensesByDayRaw = await Expense.aggregate(expensesByDayPipeline);

  interface DayAccumulator {
    revenue: number;
    collected: number;
    pendingCollection: number;
    cogs: number;
    expenses: number;
    orderCount: number;
  }

  const dayMap = new Map<string, DayAccumulator>();
  const dayEntry = (date: string): DayAccumulator => {
    const existing = dayMap.get(date);
    if (existing) return existing;
    const created: DayAccumulator = {
      revenue: 0,
      collected: 0,
      pendingCollection: 0,
      cogs: 0,
      expenses: 0,
      orderCount: 0
    };
    dayMap.set(date, created);
    return created;
  };

  for (const row of revenueByDayRaw as Array<Record<string, unknown>>) {
    const day = dayEntry(row._id as string);
    day.revenue = (row.revenue as number) ?? 0;
    day.collected = (row.collected as number) ?? 0;
    day.pendingCollection = (row.pendingCollection as number) ?? 0;
    day.orderCount = (row.orderCount as number) ?? 0;
  }
  for (const row of cogsByDayRaw as Array<Record<string, unknown>>) {
    dayEntry(row._id as string).cogs = (row.cogs as number) ?? 0;
  }
  for (const row of expensesByDayRaw as Array<Record<string, unknown>>) {
    dayEntry(row._id as string).expenses = (row.expenses as number) ?? 0;
  }

  const byDay: ProfitByDay[] = Array.from(dayMap.entries())
    .map(([date, day]) => {
      const dayRevenue = round2(day.revenue);
      const dayCogs = round2(day.cogs);
      const dayExpenses = round2(day.expenses);
      const dayProfit = round2(dayRevenue - dayCogs - dayExpenses);
      const dayMargin = dayRevenue > 0 ? Math.round((dayProfit / dayRevenue) * 1000) / 10 : 0;
      return {
        date,
        revenue: dayRevenue,
        collected: round2(day.collected),
        pendingCollection: round2(day.pendingCollection),
        cogs: dayCogs,
        expenses: dayExpenses,
        profit: dayProfit,
        margin: dayMargin,
        orderCount: day.orderCount
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const profit = revenue - cogs - expenses;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;

  // 5. Additive cash-basis + global receivable views (never alter accrual fields).
  const [cashBasis, receivable] = await Promise.all([
    getCashBasisReport(start, end),
    getReceivableSummary()
  ]);

  const result: ProfitReport = {
    revenue,
    collected,
    pendingCollection,
    cogs,
    expenses,
    profit,
    margin,
    partialCOGS: false,
    byDay,
    cashBasis,
    receivable
  };

  if (nullCostPriceCount > 0) {
    result.partialCOGS = true;
    result.disclaimer = `${nullCostPriceCount} products missing cost price`;
  }

  return result;
};

// ─── Customer history ────────────────────────────────────────────────────────

/**
 * Returns all orders for a customer with computed analytics fields.
 */
export const getCustomerHistory = async (customerId: string): Promise<CustomerHistory> => {
  if (!Types.ObjectId.isValid(customerId)) {
    throw new AppError('Invalid customer ID', 400);
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const orders = await Order.find({ customerId: new Types.ObjectId(customerId) })
    .select('orderNumber totalAmount status paymentStatus createdAt orderDate')
    .sort({ orderDate: -1, createdAt: -1 });

  const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const orderCount = orders.length;
  const avgOrderValue = orderCount > 0 ? Math.round((totalSpent / orderCount) * 100) / 100 : 0;
  const lastPurchaseDate = orderCount > 0 ? (orders[0]!.orderDate ?? orders[0]!.createdAt) : null;

  return {
    customerId,
    customerName: customer.name,
    orders: orders.map(o => ({
      _id: o._id.toString(),
      orderNumber: o.orderNumber,
      totalAmount: o.totalAmount,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
      orderDate: o.orderDate ?? o.createdAt
    })),
    totalSpent,
    orderCount,
    avgOrderValue,
    lastPurchaseDate
  };
};

// ─── Customer frequency ──────────────────────────────────────────────────────

/**
 * Returns order counts grouped by period (weekly or monthly) for a customer.
 */
export const getCustomerFrequency = async (
  customerId: string,
  period: 'weekly' | 'monthly',
  startDate?: string,
  endDate?: string
): Promise<CustomerFrequency> => {
  if (!Types.ObjectId.isValid(customerId)) {
    throw new AppError('Invalid customer ID', 400);
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const matchStage: Record<string, unknown> = {
    customerId: new Types.ObjectId(customerId)
  };

  if (startDate && endDate) {
    const { start, end } = parseDateRange(startDate, endDate);
    Object.assign(matchStage, orderDateRangeMatch(start, end));
  }

  const dateFormat = period === 'monthly' ? '%Y-%m' : '%Y-W%V';

  // Bucket by the ART calendar explicitly instead of the server's local
  // timezone: the business reasons in business days, and the bucket must not
  // drift when the process runs with a different TZ (tests, CI, containers).
  const pipeline: PipelineStage[] = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          $dateToString: {
            format: dateFormat,
            date: { $ifNull: ['$orderDate', '$createdAt'] },
            timezone: BUSINESS_TIMEZONE
          }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ];

  const results = await Order.aggregate(pipeline);

  const periods: FrequencyPeriod[] = results.map((r: Record<string, unknown>) => ({
    period: r._id as string,
    count: r.count as number
  }));

  return { customerId, period, periods };
};

// ─── Top customers ───────────────────────────────────────────────────────────

/**
 * Returns top N customers ranked by total revenue from delivered orders.
 */
export const getTopCustomers = async (limit = 10): Promise<TopCustomer[]> => {
  if (limit <= 0) {
    throw new AppError('limit must be a positive number', 400);
  }

  const pipeline: PipelineStage[] = [
    { $match: { status: 'delivered' } },
    {
      $group: {
        _id: '$customerId',
        customerName: { $first: '$customerName' },
        totalRevenue: { $sum: '$totalAmount' },
        orderCount: { $sum: 1 }
      }
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: limit }
  ];

  const results = await Order.aggregate(pipeline);

  return results.map((r: Record<string, unknown>) => ({
    customerId: (r._id as Types.ObjectId).toString(),
    customerName: r.customerName as string,
    totalRevenue: r.totalRevenue as number,
    orderCount: r.orderCount as number
  }));
};
