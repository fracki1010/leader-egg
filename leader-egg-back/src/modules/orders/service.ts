import { Types } from 'mongoose';
import { AppError, CreditLimitExceededError, DuplicateRecordError, InsufficientStockError } from '../../middleware/error-handler.js';
import { Order, type IOrder, type OrderStatus, type PaymentStatus, type OrderChannel, type SalesChannel, type IOrderItem } from './model.js';
import { Customer } from '../customers/model.js';
import { Product } from '../products/model.js';
import { Payment, accountForMethod } from '../payments/model.js';
import { getActivePrice, convertToMaples } from '../products/service.js';
import type { ProductUnit } from '../products/units.js';
import { resolveBestPromo, applyPromoPrice, incrementSold, restoreSold } from '../promotions/service.js';
import { incrementStock, decrementStock } from '../inventory/service.js';
import { Inventory } from '../inventory/model.js';
import { Return } from '../returns/model.js';
import { CashAdjustment } from '../cash-adjustments/model.js';
import { CustomerCharge } from '../customer-charges/model.js';
import type { CreateOrderInput, UpdateOrderInput, CancelMoneyAction } from './schema.js';
import { getNextOrderNumber } from '../counters/model.js';
import { computeDueDate, checkCreditLimit, getCustomerOutstanding } from './credit-service.js';
import { calendarComponents, startOfCalendarDay, endOfCalendarDay } from '../../utils/calendar-day.js';
import {
  buildDuplicateFingerprint,
  DUPLICATE_MESSAGE_MINUTES,
  DUPLICATE_WINDOW_MS
} from '../../utils/duplicate-guard.js';

// ─── State machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['assigned', 'cancelled'],
  assigned: ['in_transit', 'cancelled', 'pending'],
  in_transit: ['delivered', 'cancelled', 'assigned'],
  delivered: ['in_transit'], // undo delivery → restores stock
  cancelled: []
};

const isValidTransition = (from: OrderStatus, to: OrderStatus): boolean => {
  return VALID_TRANSITIONS[from].includes(to);
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Order-level discount resolved against the priced order subtotal. */
interface ResolvedBonification {
  type: 'amount' | 'percent';
  value: number;
  amount: number;
}

/**
 * Resolves the requested order-level bonification into a concrete money
 * discount. `amount` is always derived server-side from the priced subtotal so
 * the client can never send a discount larger than the order.
 */
const resolveBonification = (
  input: CreateOrderInput['bonification'],
  subtotal: number
): ResolvedBonification | null => {
  if (!input) {
    return null;
  }

  if (input.type === 'amount') {
    if (input.value > subtotal) {
      throw new AppError(
        `La bonificación ($${input.value}) no puede superar el subtotal ($${subtotal})`,
        400
      );
    }
    return { type: 'amount', value: input.value, amount: round2(input.value) };
  }

  if (input.value > 100) {
    throw new AppError('La bonificación porcentual no puede superar el 100%', 400);
  }
  return { type: 'percent', value: input.value, amount: round2((subtotal * input.value) / 100) };
};

/** Order-level surcharge resolved against the priced order subtotal. */
interface ResolvedSurcharge {
  type: 'amount' | 'percent';
  value: number;
  amount: number;
}

/**
 * Resolves the requested order-level surcharge into a concrete money amount.
 * `amount` is always derived server-side from the priced subtotal; it is added
 * on top of the (possibly discounted) order total.
 */
const resolveSurcharge = (
  input: CreateOrderInput['surcharge'],
  subtotal: number
): ResolvedSurcharge | null => {
  if (!input) {
    return null;
  }

  if (input.type === 'amount') {
    return { type: 'amount', value: input.value, amount: round2(input.value) };
  }

  if (input.value > 100) {
    throw new AppError('El recargo porcentual no puede superar el 100%', 400);
  }
  return { type: 'percent', value: input.value, amount: round2((subtotal * input.value) / 100) };
};

// ─── Promo booking lifecycle ─────────────────────────────────────────────────

/** A stock-limited promo booking, in the unit the order line was booked with. */
interface PromoBooking {
  promotionId: string;
  quantity: number;
}

/** Snapshot stored on an order item when a promo priced that line. */
type PromoSnapshot = {
  promotionId: Types.ObjectId;
  name: string;
  type: 'fixed_price' | 'discount_percent' | 'buy_x_get_y';
  value: number;
  stockLimit: number | null;
};

/** Priced line rebuilt by updateOrder before it is assigned to the order. */
interface PricedOrderItem {
  productId: Types.ObjectId;
  productName: string;
  quantity: number;
  unit: ProductUnit;
  mapleQty: number;
  unitPrice: number;
  originalUnitPrice?: number;
  promo?: PromoSnapshot;
  subtotal: number;
}

/** Releases a set of promo bookings; best-effort so it never masks the cause. */
const releasePromoBookings = async (bookings: PromoBooking[]): Promise<void> => {
  for (const booking of bookings) {
    try {
      await restoreSold(booking.promotionId, booking.quantity);
    } catch {
      // Best-effort rollback: report the original error, not the cleanup one.
    }
  }
};

/** Re-books a set of promo bookings on a best-effort basis (compensation). */
const tryBookPromoBookings = async (bookings: PromoBooking[]): Promise<void> => {
  for (const booking of bookings) {
    try {
      await incrementSold(booking.promotionId, booking.quantity);
    } catch {
      // Best-effort compensation: the original error stays the reported one.
    }
  }
};

/** Stock-limited bookings snapshotted on an existing order's items. */
const collectPromoBookings = (items: IOrderItem[]): PromoBooking[] => {
  const bookings: PromoBooking[] = [];
  for (const item of items) {
    if (item.promo && item.promo.stockLimit != null) {
      bookings.push({
        promotionId: item.promo.promotionId.toString(),
        quantity: item.quantity
      });
    }
  }
  return bookings;
};

// ─── Order operations ───────────────────────────────────────────────────────

export interface OrderUserContext {
  userId: string;
  role: string;
}

/** Maples an order/return line moves. Legacy docs without mapleQty fall back to quantity. */
const lineMaples = (item: IOrderItem): number => item.mapleQty ?? item.quantity;

/**
 * Deducts an order's stock ONCE, atomically from the caller's point of view.
 *
 * The plan is built per product (not per line): each order line contributes
 * `mapleQty ?? quantity`, minus every maple already returned on this order
 * (`Return.items[].mapleQty ?? quantity`, floored at 0). Netting the returns is
 * what makes a return registered while the order is still `in_transit` count:
 * those goods never left the warehouse, so the later delivery must not deduct
 * them again.
 *
 * Phases:
 *  1. Read + validate — one Inventory query. A product without an Inventory
 *     record has 0 available, so it fails as InsufficientStockError (never as
 *     a 404); NOTHING is written.
 *  2. Deduct sequentially. If a later deduction still fails (concurrent race
 *     after validation), the items already deducted are restored with
 *     `incrementStock` and the original error is rethrown — no partial
 *     deduction is ever left behind.
 *
 * The caller is the only one that flips `order.stockDeducted` after this
 * resolves; the helper never touches the order document.
 */
export const deductStockForOrder = async (
  order: IOrder,
  userId: string,
  notes: string
): Promise<void> => {
  const orderId = order._id.toString();

  // 1. Plan: gross maples per product, net of what was already returned.
  const grossByProduct = new Map<string, number>();
  for (const item of order.items) {
    const key = item.productId.toString();
    grossByProduct.set(key, (grossByProduct.get(key) ?? 0) + lineMaples(item));
  }

  const returnedByProduct = new Map<string, number>();
  const returns = await Return.find({ orderId: order._id });
  for (const returnDoc of returns) {
    for (const item of returnDoc.items) {
      const key = item.productId.toString();
      returnedByProduct.set(key, (returnedByProduct.get(key) ?? 0) + (item.mapleQty ?? item.quantity));
    }
  }

  const plan: Array<{ productId: string; quantity: number }> = [];
  for (const [productId, gross] of grossByProduct) {
    const net = Math.max(0, gross - (returnedByProduct.get(productId) ?? 0));
    if (net > 0) {
      plan.push({ productId, quantity: net });
    }
  }

  // Everything was returned — no stock movement is owed.
  if (plan.length === 0) {
    return;
  }

  // 2. Pre-validate the whole plan before writing anything.
  const records = await Inventory.find({ productId: { $in: plan.map((entry) => entry.productId) } });
  const recordByProduct = new Map(records.map((record) => [record.productId.toString(), record]));
  for (const entry of plan) {
    const record = recordByProduct.get(entry.productId);
    // No record → nothing was ever received for this product: 0 available.
    if (!record) {
      throw new InsufficientStockError(entry.productId, entry.quantity, 0);
    }
    if (record.quantity < entry.quantity) {
      throw new InsufficientStockError(entry.productId, entry.quantity, record.quantity);
    }
  }

  // 3. Deduct sequentially; compensate anything already deducted on failure.
  const deducted: Array<{ productId: string; quantity: number }> = [];
  try {
    for (const entry of plan) {
      await decrementStock(entry.productId, entry.quantity, orderId, userId, notes);
      deducted.push(entry);
    }
  } catch (error) {
    for (const entry of deducted) {
      await incrementStock(
        entry.productId,
        entry.quantity,
        `${notes} — reversión por entrega fallida ${order.orderNumber}`,
        userId,
        'delivery',
        undefined,
        orderId
      );
    }
    throw error;
  }
};

export const createOrder = async (
  input: CreateOrderInput,
  user?: OrderUserContext
): Promise<IOrder> => {
  // Stall (puesto) enforcement (design D2): the server is the single source of
  // truth. A puesto user can only register walk-in stall sales — any other
  // channel/salesChannel is rejected (400), and both fields are forced when
  // omitted so the frontend can never misroute a stall sale.
  const isPuesto = user?.role === 'puesto';
  if (isPuesto) {
    if (input.salesChannel !== undefined && input.salesChannel !== 'puesto') {
      throw new AppError('El puesto solo puede registrar ventas de mostrador', 400);
    }
    if (input.channel !== undefined && input.channel !== 'walk_in') {
      throw new AppError('El puesto solo puede registrar ventas de mostrador', 400);
    }
  }

  const channel = isPuesto ? 'walk_in' : input.channel;
  if (!channel) {
    throw new AppError('Channel is required', 400);
  }
  const salesChannel = isPuesto ? 'puesto' : (input.salesChannel ?? 'reparto');

  // Recent-duplicate guard. Fingerprints only the customer + sorted lines, so a
  // retried submit with the same payload is caught BEFORE any counter, stock,
  // promo or payment work. A cancelled order never blocks a new one, and an
  // explicit forceDuplicate (confirmed by the user in the UI) bypasses it.
  const duplicateFingerprint = buildDuplicateFingerprint(input.customerId, input.items);
  if (input.forceDuplicate !== true) {
    const existing = await Order.findOne({
      duplicateFingerprint,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }
    }).sort({ createdAt: -1 });

    if (existing) {
      throw new DuplicateRecordError(
        `Ya existe un pedido igual (${existing.orderNumber}) creado hace menos de ${DUPLICATE_MESSAGE_MINUTES} minutos.`,
        'order',
        existing._id.toString(),
        existing.orderNumber,
        existing.createdAt
      );
    }
  }

  // Verify customer exists and is active
  const customer = await Customer.findById(input.customerId);
  if (!customer) {
    throw new AppError('Customer not found', 404);
  }
  if (customer.status !== 'active') {
    throw new AppError('Cannot create order for inactive customer', 409);
  }

  // Every stock-limited promo booking made during pricing is tracked here so a
  // failure anywhere below can release EXACTLY those bookings — once.
  const bookings: PromoBooking[] = [];
  let order: IOrder | null = null;

  try {
    // Build order items with price snapshots
    const orderItems = [];
    // Order-level subtotal (Σ item subtotals, before any bonification).
    let orderSubtotal = 0;

    for (const item of input.items) {
      // Verify product exists
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404);
      }

      // Resolve the item's unit (default 'maple') and the converted maple qty
      const unit = item.unit ?? 'maple';
      const mapleQty = convertToMaples(product, item.quantity, unit);

      // Get active price for the item's unit (snapshot)
      const priceEntry = await getActivePrice(item.productId, unit);
      const basePrice = priceEntry.price;

      // Resolve the most favorable active promo for (product, unit, quantity).
      // When found: price the line with the promo, snapshot the promo reference
      // + the original base unit price, and atomically book stock-limited sold
      // quantity (design D4 + D5).
      const promo = await resolveBestPromo(item.productId, unit, item.quantity);
      let unitPrice = basePrice;
      let itemSubtotal = basePrice * item.quantity;
      let promoSnapshot: PromoSnapshot | undefined;
      let originalUnitPrice: number | undefined;

      if (promo) {
        const applied = applyPromoPrice(basePrice, promo, item.quantity);
        unitPrice = applied.unitPrice;
        itemSubtotal = applied.subtotal;
        originalUnitPrice = basePrice;
        promoSnapshot = {
          promotionId: promo._id as Types.ObjectId,
          name: promo.name,
          type: promo.type,
          value: promo.value,
          stockLimit: promo.stockLimit ?? null
        };

        // Atomic full-quantity oversell guard. Throws a 409 when the line does
        // not fit under the remaining stock; the catch below then releases the
        // bookings already made by this call.
        if (promo.stockLimit != null) {
          await incrementSold(promo._id.toString(), item.quantity);
          bookings.push({
            promotionId: promo._id.toString(),
            quantity: item.quantity
          });
        }
      }

      orderItems.push({
        productId: product._id,
        productName: product.displayName,
        quantity: item.quantity,
        unit,
        mapleQty,
        unitPrice,
        originalUnitPrice,
        promo: promoSnapshot,
        subtotal: itemSubtotal
      });

      orderSubtotal += itemSubtotal;
    }

    // Order-level bonification and surcharge: both resolved against the priced
    // subtotal and combined into the final total. Everything downstream (credit
    // check, payment cap, balance, reports) keeps operating on `totalAmount`.
    const bonification = resolveBonification(input.bonification, orderSubtotal);
    const surcharge = resolveSurcharge(input.surcharge, orderSubtotal);
    const totalAmount = round2(
      Math.max(0, orderSubtotal - (bonification?.amount ?? 0) + (surcharge?.amount ?? 0))
    );

    // Compute due date from customer credit config
    const termDays = customer.creditConfig?.termDays ?? 0;
    const dueDate = computeDueDate(termDays);

    // Credit limit check (unless admin bypass)
    const isAdmin = user?.role === 'admin';
    const wantsBypass = input.bypassCreditCheck === true;
    const bypassEffective = wantsBypass && isAdmin;

    if (!bypassEffective) {
      const creditCheck = await checkCreditLimit(input.customerId, totalAmount);
      if (!creditCheck.allowed) {
        throw new CreditLimitExceededError(
          creditCheck.outstandingBalance ?? 0,
          totalAmount,
          creditCheck.creditLimit ?? 0,
          creditCheck.overage ?? 0
        );
      }
    }

    // Generate order number from DB counter (atomic, restart-safe)
    const orderNumber = await getNextOrderNumber();

    // Shipping: use provided deliveryAddress or fall back to the customer's address
    const deliveryAddress = input.deliveryAddress?.trim() || customer.address;

    // Optional REAL upfront payment(s) (partial preference). A split payment
    // arrives as `initialPayments[]`; the legacy single `initialPayment` still
    // works (back-compat) and is normalized into the same list. Validate the SUM
    // against the total BEFORE creating the order so a rejected amount never
    // leaves a dangling order behind.
    const initialPaymentLines =
      input.initialPayments ?? (input.initialPayment ? [input.initialPayment] : []);
    const paidAmount = initialPaymentLines.reduce((sum, line) => sum + line.amount, 0);
    if (paidAmount > totalAmount) {
      throw new AppError(
        `Initial payment amount ($${paidAmount}) cannot exceed order total ($${totalAmount})`,
        400
      );
    }
    const balance = totalAmount - paidAmount;
    const paymentStatus: PaymentStatus = paidAmount === 0 ? 'unpaid' : balance === 0 ? 'paid' : 'partial';

    order = await Order.create({
      orderNumber,
      customerId: customer._id,
      customerName: customer.name,
      channel,
      paymentPreference: input.paymentPreference ?? 'cash',
      salesChannel,
      deliveryAddress,
      deliveryNotes: input.deliveryNotes,
      deliveryLocation: input.deliveryLocation,
      deliveryDate: input.deliveryDate ?? null,
      orderDate: normalizeOrderDate(input.orderDate ?? new Date()),
      items: orderItems,
      subtotal: orderSubtotal,
      duplicateFingerprint,
      bonification,
      surcharge,
      totalAmount,
      paidAmount,
      balance,
      paymentStatus,
      status: input.status ?? 'pending',
      dueDate
    });

    // A sale can be registered as ALREADY DELIVERED (e.g. a counter sale that
    // leaves the warehouse immediately). Creation is then also the delivery
    // event, so the stock has to leave inventory right here — exactly like the
    // direct-delivery branch of `transitionOrderStatus`. Without this, the order
    // would claim `delivered` while the warehouse still counted those maples.
    if (input.status === 'delivered') {
      await deductStockForOrder(order, user?.userId ?? 'system', `Entrega ${orderNumber}`);
      order.stockDeducted = true;
      await order.save();
    }

    // Each upfront line is a REAL Payment doc — it shows up in the order's
    // payment history exactly like a later recordPayment would. The money
    // account is derived from the method unless an explicit override was sent
    // (e.g. transfer → bank). A split payment creates one doc per line.
    for (const line of initialPaymentLines) {
      await Payment.create({
        orderId: order._id,
        amount: line.amount,
        method: line.method,
        account: accountForMethod(line.method, line.account),
        date: new Date()
      });
    }

    // Push audit log entry after creation (needs the order's _id)
    if (bypassEffective && user) {
      order.auditLog.push({
        adminUserId: user.userId,
        customerId: input.customerId,
        orderId: order._id.toString(),
        overageAmount: 0,
        timestamp: new Date()
      } as any);
      await order.save();
    }

    return order;
  } catch (error) {
    // All-or-nothing creation: roll back the order (and its upfront payments),
    // any delivered-stock movement, and the promo bookings made by THIS call.
    // The bookings list is the single source of truth, so nothing is released
    // twice regardless of where the failure happened.
    if (order) {
      const createdOrder = order;
      try {
        if (createdOrder.stockDeducted) {
          await restoreStockForOrder(
            createdOrder,
            `Reversión por creación fallida ${createdOrder.orderNumber}`,
            user?.userId ?? 'system'
          );
        }
        await Payment.deleteMany({ orderId: createdOrder._id });
        await Order.findByIdAndDelete(createdOrder._id);
      } catch {
        // Best-effort rollback: never mask the original failure.
      }
    }
    await releasePromoBookings(bookings);
    throw error;
  }
};

// ─── Order list with filters and pagination ─────────────────────────────────

/**
 * Normalizes a business/sale date to LOCAL NOON of the calendar day the client
 * meant. A date-only string ('2026-09-24') parses to UTC midnight; the shared
 * `calendarComponents` helper recovers those UTC components, while a real
 * instant is read on the server's local calendar.
 *
 * Noon is deliberate: the stored instant stays inside the intended day for any
 * timezone offset smaller than 12 hours, so later day groupings ($dateToString
 * in BUSINESS_TIMEZONE) can never spill the sale into a neighboring day.
 */
export const normalizeOrderDate = (value: Date): Date => {
  const { y, m, d } = calendarComponents(value);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

export interface OrderListFilter {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  customerId?: string;
  channel?: OrderChannel;
  salesChannel?: SalesChannel;
  from?: Date;
  to?: Date;
  search?: string;
  limit?: number;
  page?: number;
}

export interface OrderListResult {
  items: IOrder[];
  total: number;
  page: number;
  limit: number;
}

export const listOrders = async (filter: OrderListFilter = {}, user?: OrderUserContext): Promise<OrderListResult> => {
  const query: Record<string, unknown> = {};

  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.paymentStatus) {
    query.paymentStatus = filter.paymentStatus;
  }
  if (filter.customerId) {
    if (!Types.ObjectId.isValid(filter.customerId)) {
      throw new AppError('Invalid customerId', 400);
    }
    query.customerId = new Types.ObjectId(filter.customerId);
  }
  if (filter.channel) {
    query.channel = filter.channel;
  }
  if (filter.salesChannel) {
    query.salesChannel = filter.salesChannel;
  }

  // Date range: from/to are calendar dates → start/end of the local day.
  // Matches the business/sale date; legacy docs without `orderDate` fall back
  // to their capture timestamp. Wrapped in $and so it never clobbers the
  // `search` $or built below.
  if (filter.from || filter.to) {
    const orderDate: Record<string, Date> = {};
    if (filter.from) {
      orderDate.$gte = startOfCalendarDay(filter.from);
    }
    if (filter.to) {
      orderDate.$lte = endOfCalendarDay(filter.to);
    }
    query.$and = [
      ...((query.$and as unknown[]) ?? []),
      { $or: [{ orderDate }, { orderDate: { $exists: false }, createdAt: orderDate }] }
    ];
  }

  // Search across order number and customer name (case-insensitive substring)
  if (filter.search) {
    const escaped = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { orderNumber: { $regex: escaped, $options: 'i' } },
      { customerName: { $regex: escaped, $options: 'i' } }
    ];
  }

  // Stall (puesto) users only ever see their own channel — overrides any
  // client-supplied salesChannel filter (design D3).
  if (user?.role === 'puesto') {
    query.salesChannel = 'puesto';
  }

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Order.find(query).sort({ orderDate: -1, createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(query)
  ]);

  return { items, total, page, limit };
};

export const getOverdueOrders = async (user?: OrderUserContext): Promise<IOrder[]> => {
  const now = new Date();
  const match: Record<string, unknown> = {
    dueDate: { $lt: now, $ne: null },
    paymentStatus: { $ne: 'paid' }
  };
  // Stall users only see overdue stall orders (design D3).
  if (user?.role === 'puesto') {
    match.salesChannel = 'puesto';
  }
  return Order.find(match).sort({ dueDate: 1 });
};

// ─── Today's orders summary ─────────────────────────────────────────────────

export interface TodayOrdersResult {
  orders: IOrder[];
  summary: { total: number; count: number };
}

export const getTodayOrders = async (user?: OrderUserContext): Promise<TodayOrdersResult> => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const range = { $gte: start, $lte: end };
  const match: Record<string, unknown> = {
    $or: [
      { orderDate: range },
      { orderDate: { $exists: false }, createdAt: range }
    ]
  };
  // Stall users get a stall-only day summary (design D3).
  if (user?.role === 'puesto') {
    match.salesChannel = 'puesto';
  }

  const orders = await Order.find(match).sort({ orderDate: -1, createdAt: -1 });

  const total = orders.reduce((sum, order) => sum + order.totalAmount, 0);
  return { orders, summary: { total, count: orders.length } };
};

export const getOrderById = async (id: string, user?: OrderUserContext): Promise<IOrder> => {
  const order = await Order.findById(id);
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  // Stall users cannot read non-stall orders — 404 hides the existence of the
  // document (design D3), same as a missing order.
  if (user?.role === 'puesto' && order.salesChannel !== 'puesto') {
    throw new AppError('Order not found', 404);
  }
  return order;
};

// ─── Edit order (admin, pending only) ───────────────────────────────────────

export const updateOrder = async (
  id: string,
  input: UpdateOrderInput,
  user?: OrderUserContext
): Promise<IOrder> => {
  const order = await Order.findById(id);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (order.status !== 'pending') {
    throw new AppError('Cannot edit order after assignment', 409);
  }

  // ── Validation phase ──────────────────────────────────────────────────────
  // Everything below is read-only: no promo counter is touched until every
  // item/price/credit check has passed. An invalid PATCH therefore never
  // restores (or re-books) promo stock.
  const oldBookings = collectPromoBookings(order.items);
  const newBookings: PromoBooking[] = [];

  let newTotal = order.totalAmount;
  let newItems: PricedOrderItem[] | null = null;

  if (input.items !== undefined) {
    const orderItems: PricedOrderItem[] = [];
    let computedTotal = 0;

    for (const item of input.items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404);
      }

      const unit = item.unit ?? 'maple';
      const mapleQty = convertToMaples(product, item.quantity, unit);
      const priceEntry = await getActivePrice(item.productId, unit);
      const basePrice = priceEntry.price;

      // Re-price the new line exactly like createOrder: the most favorable
      // active promo is resolved and its stock-limited booking is PLANNED here
      // (booked only after all validation succeeds).
      const promo = await resolveBestPromo(item.productId, unit, item.quantity);
      let unitPrice = basePrice;
      let subtotal = basePrice * item.quantity;
      let promoSnapshot: PromoSnapshot | undefined;
      let originalUnitPrice: number | undefined;

      if (promo) {
        const applied = applyPromoPrice(basePrice, promo, item.quantity);
        unitPrice = applied.unitPrice;
        subtotal = applied.subtotal;
        originalUnitPrice = basePrice;
        promoSnapshot = {
          promotionId: promo._id as Types.ObjectId,
          name: promo.name,
          type: promo.type,
          value: promo.value,
          stockLimit: promo.stockLimit ?? null
        };
        if (promo.stockLimit != null) {
          newBookings.push({
            promotionId: promo._id.toString(),
            quantity: item.quantity
          });
        }
      }

      orderItems.push({
        productId: product._id,
        productName: product.displayName,
        quantity: item.quantity,
        unit,
        mapleQty,
        unitPrice,
        originalUnitPrice,
        promo: promoSnapshot,
        subtotal
      });

      computedTotal += subtotal;
    }

    // Never reduce the total below what has already been paid
    if (computedTotal < order.paidAmount) {
      throw new AppError('Cannot reduce order total below paid amount', 409);
    }

    newTotal = computedTotal;
    newItems = orderItems;
  }

  if (input.channel !== undefined) {
    order.channel = input.channel;
  }

  if (input.paymentPreference !== undefined) {
    order.paymentPreference = input.paymentPreference;
  }

  if (input.salesChannel !== undefined) {
    order.salesChannel = input.salesChannel;
  }

  if (input.deliveryAddress !== undefined) {
    order.deliveryAddress = input.deliveryAddress.trim();
  }
  if (input.deliveryNotes !== undefined) {
    order.deliveryNotes = input.deliveryNotes.trim() || undefined;
  }
  if (input.deliveryDate !== undefined) {
    order.deliveryDate = input.deliveryDate;
  }
  if (input.orderDate !== undefined) {
    order.orderDate = normalizeOrderDate(input.orderDate);
  }
  if (input.deliveryLocation !== undefined) {
    order.deliveryLocation = input.deliveryLocation;
  }

  // Re-check credit limit with the new total
  const creditCheck = await checkCreditLimit(order.customerId.toString(), newTotal);
  if (!creditCheck.allowed) {
    throw new CreditLimitExceededError(
      creditCheck.outstandingBalance ?? 0,
      newTotal,
      creditCheck.creditLimit ?? 0,
      creditCheck.overage ?? 0
    );
  }

  // ── Apply phase ───────────────────────────────────────────────────────────
  // Validation passed: swap the promo bookings. Old bookings are freed first so
  // editing the SAME promo (e.g. changing quantity) has the quota available.
  if (newItems) {
    await releasePromoBookings(oldBookings);
    const bookedNew: PromoBooking[] = [];
    try {
      for (const booking of newBookings) {
        await incrementSold(booking.promotionId, booking.quantity);
        bookedNew.push(booking);
      }
    } catch (error) {
      // No partial state: undo the new bookings that succeeded and restore the
      // order's old bookings (best-effort) so the persisted order keeps its
      // quota when the PATCH is rejected.
      await releasePromoBookings(bookedNew);
      await tryBookPromoBookings(oldBookings);
      throw error;
    }

    order.items = newItems as any;
    // The item set changed, so existing order-level adjustments (bonification
    // and surcharge) no longer describe the total they were computed against.
    // DROP both; re-apply them by recreating the order.
    order.subtotal = newTotal;
    order.bonification = null;
    order.surcharge = null;
    order.totalAmount = newTotal;
    // Balance adjusts by (newTotal - oldTotal)
    order.balance = newTotal - order.paidAmount;
  }

  // Derive paymentStatus from balance
  if (order.balance === 0) {
    order.paymentStatus = 'paid';
  } else if (order.paidAmount > 0) {
    order.paymentStatus = 'partial';
  } else {
    order.paymentStatus = 'unpaid';
  }

  // Audit entry noting the edit
  if (user) {
    order.auditLog.push({
      adminUserId: user.userId,
      customerId: order.customerId.toString(),
      orderId: order._id.toString(),
      overageAmount: 0,
      timestamp: new Date()
    } as any);
  }

  try {
    await order.save();
  } catch (error) {
    // The document write failed after the counter swap: undo it as a unit.
    if (newItems) {
      await releasePromoBookings(newBookings);
      await tryBookPromoBookings(oldBookings);
    }
    throw error;
  }
  return order;
};

// ─── Delete order (admin, pending only) ─────────────────────────────────────

export const deleteOrder = async (id: string): Promise<void> => {
  const order = await Order.findById(id);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (order.status === 'delivered') {
    throw new AppError('Cannot delete delivered order', 409);
  }
  if (order.status === 'assigned' || order.status === 'in_transit' || order.routeId) {
    throw new AppError('Cannot delete order already in route', 409);
  }
  if (order.status === 'cancelled') {
    throw new AppError('Cannot delete cancelled order', 409);
  }

  const hasPayments = await Payment.exists({ orderId: order._id });
  if (hasPayments || order.paidAmount > 0) {
    throw new AppError('Cannot delete order with payments', 409);
  }

  // Deleting a pending order frees the promotion stock it booked at creation.
  await restorePromoSoldForOrder(order);
  await Order.findByIdAndDelete(id);
};

export const transitionOrderStatus = async (
  id: string,
  newStatus: OrderStatus,
  user?: OrderUserContext,
  moneyAction?: CancelMoneyAction
): Promise<IOrder> => {
  const order = await Order.findById(id);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (!isValidTransition(order.status, newStatus)) {
    throw new AppError(
      `Invalid status transition: cannot go from "${order.status}" to "${newStatus}"`,
      409
    );
  }

  const isCancel = newStatus === 'cancelled';

  // moneyAction only makes sense when cancelling. Reject a mispaired request
  // BEFORE any mutation so a bad payload can never half-apply a transition.
  if (moneyAction !== undefined && !isCancel) {
    throw new AppError('moneyAction solo aplica al cancelar un pedido', 400);
  }

  // Cancelling an order that already collected money must NEVER silently pick
  // an outcome: the caller has to say what happens to the money. An unpaid
  // order has nothing to move, so any moneyAction is ignored there.
  let effectiveMoneyAction: CancelMoneyAction | undefined;
  if (isCancel && order.paidAmount > 0) {
    if (moneyAction === undefined) {
      throw new AppError(
        `El pedido tiene $${order.paidAmount} cobrados: elegí qué hacer con la plata (refund_cash, refund_transfer, customer_credit, none)`,
        400
      );
    }
    effectiveMoneyAction = moneyAction;
  }

  // A money movement is written with the authenticated admin as createdBy —
  // never a placeholder. Validate before mutating so the cancellation cannot be
  // saved only to fail afterwards.
  const movesMoney = effectiveMoneyAction !== undefined && effectiveMoneyAction !== 'none';
  if (movesMoney && (!user?.userId || !Types.ObjectId.isValid(user.userId))) {
    throw new AppError(
      'Se requiere un usuario autenticado para registrar el movimiento de dinero',
      400
    );
  }

  const currentStatus = order.status;
  const undoDelivery = newStatus === 'in_transit' && currentStatus === 'delivered';

  // Guard (design D5): once a delivery has returns, it cannot be undone —
  // undoing would double-restore the returned quantity to inventory.
  if (undoDelivery && ((order.returnedAmount ?? 0) > 0 || (await Return.exists({ orderId: order._id })))) {
    throw new AppError('No se puede deshacer una entrega con devoluciones', 409);
  }

  // Stock-aware transitions. Undoing a delivery or cancelling an order whose
  // stock already left the warehouse returns the maples to inventory and
  // clears the tracking flag. stockDeducted is the single source of truth: it
  // is set by both the route path (advanceStop) and the direct delivery path
  // below, so the restore only fires when stock actually left the warehouse.
  if (order.stockDeducted && (undoDelivery || newStatus === 'cancelled')) {
    const notes = undoDelivery
      ? `Restock por deshacer entrega ${order.orderNumber}`
      : `Restock por cancelación ${order.orderNumber}`;
    await restoreStockForOrder(order, notes, user?.userId ?? 'system');
    order.stockDeducted = false;
  }

  // Direct delivery (not via a route): deduct the stock now and log the
  // inventory movement. Route deliveries already deducted it in advanceStop and
  // set stockDeducted, so this guard prevents a double decrement.
  if (newStatus === 'delivered' && !order.stockDeducted) {
    await deductStockForOrder(order, user?.userId ?? 'system', `Entrega ${order.orderNumber}`);
    order.stockDeducted = true;
  }

  order.status = newStatus;
  await order.save();

  // A cancelled order frees the promotion stock it booked at creation.
  if (newStatus === 'cancelled') {
    await restorePromoSoldForOrder(order);
  }

  // Money already collected is recorded in its OWN append-only collection
  // (cash adjustment or customer credit). The order's paidAmount/balance/
  // totalAmount are intentionally left untouched: a cancelled order is excluded
  // from every financial aggregation, and mutating it here would double-count
  // the refund/credit.
  if (movesMoney) {
    const createdBy = new Types.ObjectId(user!.userId);

    if (effectiveMoneyAction === 'customer_credit') {
      await CustomerCharge.create({
        customerId: order.customerId,
        type: 'credit',
        amount: order.paidAmount,
        reason: 'other',
        note: `Saldo a favor por cancelación ${order.orderNumber}`,
        date: new Date(),
        source: 'manual',
        createdBy
      });
    } else {
      await CashAdjustment.create({
        date: new Date(),
        account: effectiveMoneyAction === 'refund_cash' ? 'cash' : 'mp',
        amount: -order.paidAmount,
        reason: 'other',
        note: `Reintegro cancelación ${order.orderNumber}`,
        channel: order.salesChannel === 'puesto' ? 'puesto' : 'reparto',
        createdBy
      });
    }
  }

  return order;
};

// ─── Route integration helpers ────────────────────────────────────────────────

/**
 * Frees the promotion sold-quantity booked by an order that no longer exists
 * (cancelled or deleted). Only items that were priced with a STOCK-LIMITED
 * promo are restored — the snapshot records the limit so restores survive the
 * promo being edited or deleted later.
 */
const restorePromoSoldForOrder = async (order: IOrder): Promise<void> => {
  // Quantities already released by returns on this order (in the item's own
  // unit) must not be released again when the order is cancelled/deleted.
  const returnedByProduct = new Map<string, number>();
  const returns = await Return.find({ orderId: order._id });
  for (const returnDoc of returns) {
    for (const item of returnDoc.items) {
      const key = item.productId.toString();
      returnedByProduct.set(key, (returnedByProduct.get(key) ?? 0) + item.quantity);
    }
  }

  for (const item of order.items) {
    if (item.promo && item.promo.stockLimit != null) {
      const key = item.productId.toString();
      const alreadyReleased = returnedByProduct.get(key) ?? 0;
      const remaining = Math.max(0, item.quantity - alreadyReleased);
      if (remaining > 0) {
        await restoreSold(item.promo.promotionId.toString(), remaining);
      }
      // Consume the returned units so a duplicate product line does not
      // subtract them twice.
      if (alreadyReleased > 0) {
        returnedByProduct.set(key, Math.max(0, alreadyReleased - item.quantity));
      }
    }
  }
};

/**
 * Returns the maples an order's items deducted at delivery back to inventory.
 * Stock is tracked in maples, so each item restores by mapleQty (cajón items
 * were converted at order creation); legacy orders without mapleQty fall back
 * to the raw quantity, mirroring the decrement logic in advanceStop.
 */
const restoreStockForOrder = async (order: IOrder, notes: string, userId: string): Promise<void> => {
  for (const item of order.items) {
    const restoreQty = lineMaples(item);
    await incrementStock(
      item.productId.toString(),
      restoreQty,
      notes,
      userId,
      'delivery',
      undefined,
      order._id.toString()
    );
  }
};

export const getOrdersByRoute = async (routeId: string): Promise<IOrder[]> => {
  return Order.find({ routeId });
};

export const linkOrderToRoute = async (
  orderId: string,
  routeId: string,
  stopId: string
): Promise<IOrder> => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  order.routeId = new Types.ObjectId(routeId);
  order.routeStopId = new Types.ObjectId(stopId);
  await order.save();
  return order;
};

export const clearRouteFromOrder = async (orderId: string): Promise<IOrder> => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  order.routeId = null;
  order.routeStopId = null;
  await order.save();
  return order;
};
