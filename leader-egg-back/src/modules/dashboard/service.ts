import type { PipelineStage } from 'mongoose';
import { Order } from '../orders/model.js';
import { Inventory } from '../inventory/model.js';
import { Payment, type MoneyAccount } from '../payments/model.js';
import { Expense } from '../expenses/model.js';
import { CashAdjustment } from '../cash-adjustments/model.js';
import { Customer } from '../customers/model.js';
import { BusinessConfig } from '../config/model.js';
import { Return } from '../returns/model.js';
import { Purchase } from '../purchases/model.js';
import { DailyClose } from '../daily-closes/model.js';
import {
  CUSTOMER_CHARGE_SIGNED_DELTA,
  manualBalanceByCustomer,
  manualBalanceTotal
} from '../customer-charges/service.js';
import { displayName, type ProductCaliber, type ProductVariety } from '../products/model.js';
import { toCalendarDateString } from '../../utils/calendar-day.js';

// ─── Alert types ─────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface LowStockProduct {
  name: string;
  currentStock: number;
  threshold: number;
}

export interface Alert {
  type: 'overdue_debts' | 'low_stock' | 'pending_orders';
  severity: AlertSeverity;
  count: number;
  totalAmount?: number;
  products?: LowStockProduct[];
}

// ─── Alert computation ───────────────────────────────────────────────────────

/**
 * Computes all dashboard alerts on-demand.
 * Each alert is only included when its condition is met (count > 0 or products below threshold).
 */
export const getAlerts = async (): Promise<Alert[]> => {
  const alerts: Alert[] = [];

  // 1. Overdue debts: orders past dueDate with paymentStatus != 'paid'
  const now = new Date();
  const overdueDebts = await Order.aggregate([
    {
      $match: {
        dueDate: { $ne: null, $lt: now },
        paymentStatus: { $ne: 'paid' },
        status: { $ne: 'cancelled' }
      }
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalAmount: { $sum: '$balance' }
      }
    }
  ]);

  if (overdueDebts.length > 0 && overdueDebts[0]!.count > 0) {
    alerts.push({
      type: 'overdue_debts',
      severity: 'critical',
      count: overdueDebts[0]!.count,
      totalAmount: Math.round(overdueDebts[0]!.totalAmount * 100) / 100
    });
  }

  // 2. Low stock: products with stock < product.lowStockThreshold (real inventory)
  const lowStockProducts: LowStockProduct[] = [];
  const lowStockResults = await Inventory.aggregate([
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: '$product' },
    {
      $match: {
        $expr: { $lt: ['$quantity', '$product.lowStockThreshold'] }
      }
    },
    {
      $project: {
        variety: '$product.variety',
        caliber: '$product.caliber',
        currentStock: '$quantity',
        threshold: '$product.lowStockThreshold'
      }
    }
  ]);

  for (const item of lowStockResults) {
    lowStockProducts.push({
      name: displayName({ variety: item.variety as ProductVariety, caliber: item.caliber as ProductCaliber }),
      currentStock: item.currentStock,
      threshold: item.threshold
    });
  }

  if (lowStockProducts.length > 0) {
    alerts.push({
      type: 'low_stock',
      severity: 'warning',
      count: lowStockProducts.length,
      products: lowStockProducts
    });
  }

  // 3. Pending orders: orders with status = 'pending'
  const pendingCount = await Order.countDocuments({ status: 'pending' });

  if (pendingCount > 0) {
    alerts.push({
      type: 'pending_orders',
      severity: 'info',
      count: pendingCount
    });
  }

  return alerts;
};

// ─── Consolidated dashboard summary ──────────────────────────────────────────

export interface OverdueSummary {
  count: number;
  total: number;
}

export interface StockSummaryItem {
  productId: string;
  /** Derived display name: "Blanco Chico". */
  name: string;
  variety: ProductVariety;
  caliber: ProductCaliber;
  quantity: number;
  threshold: number;
  costPrice: number | null;
  stockValue: number;
}

export interface DebtRow {
  customerId: string;
  customerName: string;
  totalDebt: number;
  ordersCount: number;
  maxDaysOverdue: number;
}

export interface CierreHoy {
  closed: boolean;
  date: string;
  difference?: number;
}

/** Per-account balances: opening + payments − expenses − refunds − purchase payments + adjustments. */
export interface Saldos {
  efectivo: number;
  mercadopago: number;
  banco: number;
  total: number;
}

export interface DashboardSummary {
  /**
   * Grand total of all money accounts — equals saldos.total. NOW includes
   * purchase payments (supplier outflows), per the cuentas-dinero decision.
   */
  caja: number;
  /**
   * Today's NET cash movement (local calendar day): payments − expenses −
   * refunds − purchase payments + manual adjustments.
   */
  cajaHoy: number;
  /** Per-account balances (Efectivo / Mercado Pago / Banco). */
  saldos: Saldos;
  /** Sum of totalAmount of orders whose business date (orderDate) is today — BILLED today. */
  ventasHoy: number;
  /**
   * GROSS money actually collected today (local calendar day) = Σ Payment.amount
   * dated today. Unlike `cajaHoy` (NET: payments − expenses − refunds −
   * purchase payments + adjustments), this is the raw collections total.
   */
  cobradoHoy: number;
  /** Today's sales split by channel (legacy docs group as 'reparto'). Σ monto == ventasHoy. */
  ventasPorCanal: Array<{ canal: string; monto: number; ordenes: number }>;
  /** Sum of non-cancelled order balances + customer openingDebt. */
  porCobrar: number;
  /** Count of distinct customers with (order balance + openingDebt) > 0. */
  clientesDeudores: number;
  /** Whether the business setup (punto cero) has been finalized. */
  puntoCeroFinalized: boolean;
  /** Overdue orders (dueDate < now, not paid, not cancelled). */
  vencidas: OverdueSummary;
  /** Inventory joined with product name/threshold/cost, stockValue = quantity × costPrice. */
  stock: StockSummaryItem[];
  totalStockValue: number;
  /** Orders delivered on today's business date (status delivered, orderDate today). */
  entregasHoy: number;
  /** Orders pending/assigned on today's business date (orderDate today). */
  pendientesHoy: number;
  /** Top 20 debtor customers grouped by balance (sorted desc). */
  deudas: DebtRow[];
  /** Whether today's cash close exists, plus its difference when closed. */
  cierreHoy: CierreHoy;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Local calendar-day boundaries for "today" (same pattern as orders getTodayOrders). */
const todayRange = (): { start: Date; end: Date } => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const sumTotal = (rows: Array<{ total?: number }>): number => rows[0]?.total ?? 0;

/**
 * Matches orders whose BUSINESS date (`orderDate`) falls inside [start, end].
 * Legacy docs created before the field existed fall back to `createdAt`.
 */
const orderDateRangeMatch = (start: Date, end: Date): Record<string, unknown> => ({
  $or: [
    { orderDate: { $gte: start, $lte: end } },
    { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }
  ]
});

/** Sum of a per-account aggregation row for the given account ('cash' | 'mp' | 'bank'). */
const totalForAccount = (
  rows: Array<{ _id: unknown; total: number }>,
  account: MoneyAccount
): number => {
  const row = rows.find((r) => r._id === account);
  return row?.total ?? 0;
};

/**
 * Per-account money position: opening balances + payments − expenses − refunds
 * − purchase payments + manual adjustments, per account.
 *
 * Shared by the dashboard summary and the Caja screen (`/v1/cash/summary`) so
 * both report the exact same saldos and can never drift apart.
 */
export const getSaldos = async (): Promise<Saldos> => {
  // Setup state: per-account opening balances fold into saldos; openingCash is
  // kept as the cash alias. Absent config (no setup yet) → zeros.
  const config = await BusinessConfig.findOne();
  const openingBalances = config?.openingBalances ?? { cash: 0, mp: 0, bank: 0 };
  const opening = {
    cash: openingBalances.cash ?? config?.openingCash ?? 0,
    mp: openingBalances.mp ?? 0,
    bank: openingBalances.bank ?? 0
  };

  // Per-account movement totals (all time). Legacy docs without an `account`
  // are attributed by their method/effect at aggregation time ($ifNull +
  // $switch) — no data rewrite needed (design D3).
  const [paymentsByAccount, expensesByAccount, refundsByAccount, purchasesByAccount, adjustmentsByAccount] = await Promise.all([
    Payment.aggregate([
      {
        $group: {
          _id: {
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
          },
          total: { $sum: '$amount' }
        }
      }
    ]),
    Expense.aggregate([
      { $group: { _id: { $ifNull: ['$account', 'cash'] }, total: { $sum: '$amount' } } }
    ]),
    Return.aggregate([
      {
        $group: {
          _id: {
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
          },
          total: { $sum: '$refundAmount' }
        }
      }
    ]),
    Purchase.aggregate([
      // Split payments: attribute each payment LINE to its own account so a
      // purchase paid half cash / half MP credits both buckets. Legacy docs
      // without a `payments` array unwind to a single pass-through null line
      // and fall back to the scalar account/method + paidAmount (design D3).
      { $match: { paidAmount: { $gt: 0 } } },
      { $unwind: { path: '$payments', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            $cond: [
              { $ne: [{ $ifNull: ['$payments.account', null] }, null] },
              '$payments.account',
              {
                $ifNull: [
                  '$account',
                  {
                    $switch: {
                      branches: [
                        { case: { $eq: ['$paymentMethod', 'cash'] }, then: 'cash' },
                        { case: { $eq: ['$paymentMethod', 'check'] }, then: 'bank' }
                      ],
                      default: 'mp'
                    }
                  }
                ]
              }
            ]
          },
          total: {
            $sum: {
              $cond: [
                { $ne: [{ $ifNull: ['$payments.amount', null] }, null] },
                '$payments.amount',
                '$paidAmount'
              ]
            }
          }
        }
      }
    ]),
    // Manual cash adjustments: SIGNED per-account total (+ adds, − removes).
    CashAdjustment.aggregate([
      { $group: { _id: '$account', total: { $sum: '$amount' } } }
    ])
  ]);

  // Per-account balances: opening + payments − expenses − refunds − purchase
  // payments + manual adjustments (signed: a positive adjustment credits the
  // account, a negative one debits it).
  const saldos: Saldos = {
    efectivo: round2(
      opening.cash
      + totalForAccount(paymentsByAccount, 'cash')
      - totalForAccount(expensesByAccount, 'cash')
      - totalForAccount(refundsByAccount, 'cash')
      - totalForAccount(purchasesByAccount, 'cash')
      + totalForAccount(adjustmentsByAccount, 'cash')
    ),
    mercadopago: round2(
      opening.mp
      + totalForAccount(paymentsByAccount, 'mp')
      - totalForAccount(expensesByAccount, 'mp')
      - totalForAccount(refundsByAccount, 'mp')
      - totalForAccount(purchasesByAccount, 'mp')
      + totalForAccount(adjustmentsByAccount, 'mp')
    ),
    banco: round2(
      opening.bank
      + totalForAccount(paymentsByAccount, 'bank')
      - totalForAccount(expensesByAccount, 'bank')
      - totalForAccount(refundsByAccount, 'bank')
      - totalForAccount(purchasesByAccount, 'bank')
      + totalForAccount(adjustmentsByAccount, 'bank')
    ),
    total: 0
  };
  saldos.total = round2(saldos.efectivo + saldos.mercadopago + saldos.banco);
  return saldos;
};

/**
 * Consolidated dashboard summary — every number the dashboard needs in one
 * response (admin + driver). Replaces the old inventory-only getSummary.
 */
export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const now = new Date();
  const { start, end } = todayRange();

  // Setup state (punto cero) is read here for the `puntoCeroFinalized` flag;
  // per-account balances come from the shared getSaldos() computation so the
  // dashboard and the Caja screen can never drift apart.
  const config = await BusinessConfig.findOne();
  const saldos = await getSaldos();

  // 2. Caja hoy: today's movements across every account (payments − expenses −
  //    refunds − purchase payments + manual adjustments paid today).
  const [paymentsToday, expensesToday, refundsToday, purchasesToday, adjustmentsToday] = await Promise.all([
    Payment.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Return.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$refundAmount' } } }
    ]),
    Purchase.aggregate([
      { $match: { date: { $gte: start, $lte: end }, paidAmount: { $gt: 0 } } },
      // Same line-vs-legacy fallback as the per-account pipeline: the grand
      // total is unchanged, but split lines are summed line-by-line.
      { $unwind: { path: '$payments', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [
                { $ne: [{ $ifNull: ['$payments.amount', null] }, null] },
                '$payments.amount',
                '$paidAmount'
              ]
            }
          }
        }
      }
    ]),
    // Manual adjustments registered today (signed total).
    CashAdjustment.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  // 3. Ventas hoy: orders whose business date is today, not cancelled
  const ventasHoyResult = await Order.aggregate([
    { $match: { status: { $ne: 'cancelled' }, ...orderDateRangeMatch(start, end) } },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } }
  ]);

  // 3b. Ventas hoy por canal — same match as ventasHoy, grouped by sales
  //     channel. Legacy orders without the field group as 'reparto'.
  const ventasPorCanalResult = await Order.aggregate([
    { $match: { status: { $ne: 'cancelled' }, ...orderDateRangeMatch(start, end) } },
    {
      $group: {
        _id: { $ifNull: ['$salesChannel', 'reparto'] },
        monto: { $sum: '$totalAmount' },
        ordenes: { $sum: 1 }
      }
    },
    { $sort: { monto: -1 } }
  ]);
  const ventasPorCanal: Array<{ canal: string; monto: number; ordenes: number }> = ventasPorCanalResult.map(
    (row: Record<string, unknown>) => ({
      canal: row._id as string,
      monto: round2(row.monto as number),
      ordenes: row.ordenes as number
    })
  );

  // 4. Por cobrar: non-cancelled order balances + customer openingDebt +
  //    net manual charges (Σ charges − Σ credits).
  const [porCobrarResult, openingDebtTotal, manualChargeTotal] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]),
    Customer.aggregate([
      { $match: { openingDebt: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$openingDebt' } } }
    ]),
    manualBalanceTotal()
  ]);

  // 5. Distinct customers with (order balance + openingDebt + manual charges) > 0.
  //    Computed as a per-customer NET so a credit can cancel an order balance
  //    and a charge-only customer (no orders) is still counted exactly once.
  const [orderNetRows, openingDebtors, chargeNetByCustomer] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: '$customerId', net: { $sum: '$balance' } } }
    ]),
    Customer.find({ openingDebt: { $gt: 0 } })
      .select('_id openingDebt')
      .lean(),
    manualBalanceByCustomer()
  ]);
  const netByCustomer = new Map<string, number>();
  const addNet = (customerId: string, amount: number): void => {
    netByCustomer.set(customerId, (netByCustomer.get(customerId) ?? 0) + amount);
  };
  for (const row of orderNetRows) addNet(String(row._id), row.net as number);
  for (const customer of openingDebtors as Array<{ _id: unknown; openingDebt?: number }>) {
    addNet(String(customer._id), customer.openingDebt ?? 0);
  }
  for (const [customerId, delta] of chargeNetByCustomer) addNet(customerId, delta);
  let clientesDeudores = 0;
  for (const net of netByCustomer.values()) {
    if (net > 0) clientesDeudores += 1;
  }

  // 6. Vencidas: overdue orders (dueDate < now, not paid, not cancelled)
  const overdueResult = await Order.aggregate([
    {
      $match: {
        dueDate: { $ne: null, $lt: now },
        paymentStatus: { $ne: 'paid' },
        status: { $ne: 'cancelled' }
      }
    },
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$balance' } } }
  ]);

  // 7. Stock: inventory joined with products, stockValue = quantity × costPrice
  const stockRows = await Inventory.aggregate<{
    productId: string;
    variety: ProductVariety;
    caliber: ProductCaliber;
    quantity: number;
    threshold: number;
    costPrice: number | null;
    stockValue: number;
  }>([
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: '$product' },
    {
      $project: {
        _id: 0,
        productId: { $toString: '$productId' },
        variety: '$product.variety',
        caliber: '$product.caliber',
        quantity: '$quantity',
        threshold: '$product.lowStockThreshold',
        costPrice: '$product.costPrice',
        stockValue: {
          $round: [{ $multiply: [{ $ifNull: ['$product.costPrice', 0] }, '$quantity'] }, 2]
        }
      }
    },
    { $sort: { variety: 1, caliber: 1 } }
  ]);
  const stock: StockSummaryItem[] = stockRows
    .map((row) => ({
      productId: row.productId,
      name: displayName({ variety: row.variety, caliber: row.caliber }),
      variety: row.variety,
      caliber: row.caliber,
      quantity: row.quantity,
      threshold: row.threshold,
      costPrice: row.costPrice,
      stockValue: row.stockValue
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalStockValue = round2(stock.reduce((sum: number, item: StockSummaryItem) => sum + item.stockValue, 0));

  // 8. Entregas de hoy
  const [entregasHoy, pendientesHoy] = await Promise.all([
    Order.countDocuments({ status: 'delivered', ...orderDateRangeMatch(start, end) }),
    Order.countDocuments({ status: { $in: ['pending', 'assigned'] }, ...orderDateRangeMatch(start, end) })
  ]);

  // 9. Deudas: group non-cancelled orders with balance > 0 by customer, UNION
  //    the manual charge term so charge-only customers appear, UNION the
  //    per-customer openingDebt so punto-cero debt is listed too, then join
  //    customer names, compute max overdue days, sort desc, limit 20.
  const deudasPipeline: PipelineStage[] = [
    { $match: { status: { $ne: 'cancelled' }, balance: { $gt: 0 } } },
    {
      $group: {
        _id: '$customerId',
        orderDebt: { $sum: '$balance' },
        ordersCount: { $sum: 1 },
        fallbackName: { $first: '$customerName' },
        maxDaysOverdue: {
          $max: {
            $cond: [
              { $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] },
              { $dateDiff: { startDate: '$dueDate', endDate: now, unit: 'day' } },
              0
            ]
          }
        }
      }
    },
    // Charge-only customers (no orders) enter here with their signed delta.
    {
      $unionWith: {
        coll: 'customercharges',
        pipeline: [
          { $group: { _id: '$customerId', manualDelta: { $sum: CUSTOMER_CHARGE_SIGNED_DELTA } } }
        ]
      }
    } as PipelineStage,
    // Opening-debt customers (punto cero) enter here. openingDebt is a single
    // field per customer, so it contributes exactly once to the merge below.
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
      // Merge the branches per customer and fold the manual + opening terms in.
      $group: {
        _id: '$_id',
        orderDebt: { $sum: { $ifNull: ['$orderDebt', 0] } },
        manualDelta: { $sum: { $ifNull: ['$manualDelta', 0] } },
        openingDebt: { $sum: { $ifNull: ['$openingDebt', 0] } },
        ordersCount: { $sum: { $ifNull: ['$ordersCount', 0] } },
        maxDaysOverdue: { $max: { $ifNull: ['$maxDaysOverdue', 0] } },
        fallbackName: { $first: '$fallbackName' }
      }
    },
    { $addFields: { totalDebt: { $add: ['$orderDebt', '$manualDelta', '$openingDebt'] } } },
    // A credit can cancel the order debt → only keep net debtors.
    { $match: { totalDebt: { $gt: 0 } } },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
    { $sort: { totalDebt: -1 } },
    { $limit: 20 }
  ];
  const deudasRaw = await Order.aggregate(deudasPipeline);

  const deudas: DebtRow[] = deudasRaw.map((row) => ({
    customerId: String(row._id),
    customerName: row.customer?.name ?? (row.fallbackName as string),
    totalDebt: round2(row.totalDebt as number),
    ordersCount: row.ordersCount as number,
    maxDaysOverdue: row.maxDaysOverdue as number
  }));

  // 10. Cierre de hoy: today's REPARTO close (if any) drives the dashboard
  // banner. Since closes are now unique per (date, channel), the banner keeps
  // reflecting the reparto (delivery) close — the stall close is surfaced by
  // the frontend "Cerrar puesto" CTA instead.
  const todayClose = await DailyClose.findOne({ date: { $gte: start, $lte: end }, channel: 'reparto' });
  const cierreHoy: CierreHoy = todayClose
    ? {
        closed: true,
        date: toCalendarDateString(todayClose.date),
        difference: todayClose.difference
      }
    : { closed: false, date: toCalendarDateString(start) };

  return {
    // caja = grand total across accounts (NOW includes purchase payments).
    caja: saldos.total,
    cajaHoy: round2(
      sumTotal(paymentsToday)
      - sumTotal(expensesToday)
      - sumTotal(refundsToday)
      - sumTotal(purchasesToday)
      + sumTotal(adjustmentsToday)
    ),
    saldos,
    ventasHoy: round2(sumTotal(ventasHoyResult)),
    // GROSS collections today: reuse the payments-today aggregation (step 2).
    // cajaHoy is NET of expenses/refunds/purchases/adjustments; cobradoHoy is
    // the raw Σ Payment.amount for the day.
    cobradoHoy: round2(sumTotal(paymentsToday)),
    ventasPorCanal,
    porCobrar: round2(sumTotal(porCobrarResult) + sumTotal(openingDebtTotal) + manualChargeTotal),
    clientesDeudores,
    puntoCeroFinalized: config?.puntoCeroFinalized ?? false,
    vencidas: {
      count: overdueResult[0]?.count ?? 0,
      total: round2(overdueResult[0]?.total ?? 0)
    },
    stock,
    totalStockValue,
    entregasHoy,
    pendientesHoy,
    deudas,
    cierreHoy
  };
};

