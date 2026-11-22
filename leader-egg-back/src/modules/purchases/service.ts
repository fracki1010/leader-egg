import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AppError, DuplicateRecordError } from '../../middleware/error-handler.js';
import { Purchase, type IPurchase, type PurchasePaymentMethod } from './model.js';
import { accountForMethod, type MoneyAccount } from '../payments/model.js';
import { Supplier } from '../suppliers/model.js';
import { Product, displayName } from '../products/model.js';
import { incrementStock } from '../inventory/service.js';
import { Inventory } from '../inventory/model.js';
import { StockTransaction } from '../inventory/transaction-model.js';
import { getActivePrice } from '../products/service.js';
import { unitToMaples, unitToCostPerMaple, type ProductUnit } from '../products/units.js';
import { getNextPurchaseNumber } from '../counters/model.js';
import type { CreatePurchaseInput, UpdatePurchaseInput, RecordPaymentInput } from './schema.js';
import { startOfCalendarDay, endOfCalendarDay } from '../../utils/calendar-day.js';
import {
  buildDuplicateFingerprint,
  DUPLICATE_MESSAGE_MINUTES,
  DUPLICATE_WINDOW_MS
} from '../../utils/duplicate-guard.js';

// ─── Item building (shared by create + edit) ────────────────────────────────

interface BuiltItem {
  productId: Types.ObjectId;
  productName: string;
  unit: ProductUnit;
  quantity: number;
  quantityMaples: number;
  unitCost: number;
  unitCostPerMaple: number;
  subtotal: number;
}

/**
 * Validates every product and rebuilds the item list server-side. Client
 * values for derived fields (quantityMaples/unitCostPerMaple/subtotal) never
 * stick — everything is recomputed from what was entered. ALL products are
 * validated BEFORE any mutation (all-or-nothing).
 */
const buildItems = async (inputItems: CreatePurchaseInput['items']): Promise<BuiltItem[]> => {
  const products = new Map<string, { _id: Types.ObjectId; name: string; maplesPerCajon: number }>();
  for (const item of inputItems) {
    if (products.has(item.productId)) continue;
    const product = await Product.findById(item.productId);
    if (!product) {
      throw new AppError(`Product not found: ${item.productId}`, 404);
    }
    products.set(item.productId, { _id: product._id, name: displayName(product), maplesPerCajon: product.maplesPerCajon ?? 12 });
  }

  return inputItems.map((item) => {
    const product = products.get(item.productId)!;
    const unit = item.unit ?? 'maple';
    // Legacy payloads sent the maple quantity directly as quantityMaples.
    const quantity = item.quantity ?? item.quantityMaples ?? 0;
    const maplesPerCajon = product.maplesPerCajon;
    // Shared unit contract: maple → qty, medio_cajon → qty × (maplesPerCajon/2),
    // cajon → qty × maplesPerCajon. Cost per maple is the exact inverse.
    const quantityMaples = unitToMaples(quantity, unit, maplesPerCajon);
    const unitCostPerMaple = unitToCostPerMaple(item.unitCost, unit, maplesPerCajon);
    const subtotal = quantity * item.unitCost;
    return {
      productId: product._id,
      productName: product.name,
      unit,
      quantity,
      quantityMaples,
      unitCost: item.unitCost,
      unitCostPerMaple,
      subtotal
    };
  });
};

// ─── Delivery validation ────────────────────────────────────────────────────

/**
 * Read-only pre-flight for a delivery. Every referenced product must still
 * exist before ANY write happens:
 *  - unknown product → 404 `Product not found: <id>`
 *
 * An Inventory record is intentionally NOT required: the first stock entry for
 * a product creates its record on the fly (see `incrementStock`), so products
 * created by the seed without inventory can be purchased normally.
 *
 * Called before `Purchase.create` (delivered:true) and at the start of
 * `deliverPurchase`, so a failure leaves no purchase, payment line, stock
 * movement or cost change behind.
 */
const validateDeliveryItems = async (
  items: ReadonlyArray<{ productId: Types.ObjectId | string }>
): Promise<void> => {
  const productIds = [...new Set(items.map((item) => item.productId.toString()))];

  for (const productId of productIds) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new AppError(`Product not found: ${productId}`, 404);
    }
  }

  const products = await Product.find({ _id: { $in: productIds } }).select('_id');
  const existingProducts = new Set(products.map((product) => product._id.toString()));
  for (const productId of productIds) {
    if (!existingProducts.has(productId)) {
      throw new AppError(`Product not found: ${productId}`, 404);
    }
  }
};

/** Derives the payment status from paidAmount vs totalCost. */
const paymentStatusOf = (paidAmount: number, totalCost: number): 'unpaid' | 'partial' | 'paid' => {
  if (paidAmount <= 0) return 'unpaid';
  if (paidAmount >= totalCost) return 'paid';
  return 'partial';
};

/** Rounds to 2 decimals (money). */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A normalised payment line as accepted by recordPayment / createPurchase. */
interface PaymentLine {
  method: PurchasePaymentMethod;
  amount: number;
  account?: MoneyAccount;
  reference?: string;
}

/**
 * Normalises the two accepted payment payload shapes into lines:
 *  - new itemised `{ payments: [...] }` (takes precedence)
 *  - legacy single `{ method, amount, account? }` (→ a 1-line array)
 * Returns an empty array when neither shape carries a usable amount.
 */
const normalizePaymentLines = (input: {
  payments?: PaymentLine[];
  method?: PurchasePaymentMethod;
  amount?: number;
  account?: MoneyAccount;
}): PaymentLine[] => {
  if (input.payments && input.payments.length > 0) {
    return input.payments;
  }
  if (input.method !== undefined && input.amount !== undefined) {
    return [{ method: input.method, amount: input.amount, account: input.account }];
  }
  return [];
};

/** Sums the line amounts, rounded to 2 decimals. */
const sumLines = (lines: PaymentLine[]): number => round2(lines.reduce((sum, line) => sum + line.amount, 0));

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Registers a purchase as PENDING — NO stock change at creation.
 *  1. Validates the supplier (must exist and be active) and every product
 *     (all-or-nothing).
 *  2. Computes subtotals/total server-side (client values are ignored).
 *  3. Persists the numbered purchase document (PUR-YYYYMMDD-###).
 *  4. Optional payment info (method + paidAmount) is recorded immediately.
 *  5. When `delivered: true`, stock enters right away (same path as
 *     PATCH /:id/deliver) — otherwise the admin marks it delivered later.
 */
export const createPurchase = async (input: CreatePurchaseInput, userId: string): Promise<IPurchase> => {
  // Recent-duplicate guard. Runs before the supplier/product reads, the number
  // counter and every write, so a retried submit cannot create a second
  // purchase, consume a PUR number or move stock. Cancelled duplicates never
  // block; an explicit forceDuplicate bypasses it.
  const duplicateFingerprint = buildDuplicateFingerprint(
    input.supplierId,
    input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity ?? item.quantityMaples ?? 0,
      unit: item.unit
    }))
  );

  if (input.forceDuplicate !== true) {
    const existing = await Purchase.findOne({
      duplicateFingerprint,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }
    }).sort({ createdAt: -1 });

    if (existing) {
      throw new DuplicateRecordError(
        `Ya existe una compra igual (${existing.purchaseNumber}) creada hace menos de ${DUPLICATE_MESSAGE_MINUTES} minutos.`,
        'purchase',
        existing._id.toString(),
        existing.purchaseNumber,
        existing.createdAt
      );
    }
  }

  // Validate supplier exists and is active
  const supplier = await Supplier.findById(input.supplierId);
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  if (!supplier.active) {
    throw new AppError('Cannot register purchase for inactive supplier', 409);
  }

  const items = await buildItems(input.items);
  const totalCost = items.reduce((sum, item) => sum + item.subtotal, 0);

  // A delivered purchase enters stock immediately. Validate every inventory
  // record BEFORE creating the document (and before consuming a purchase
  // number) so a failure writes NOTHING at all.
  if (input.delivered) {
    await validateDeliveryItems(items);
  }

  // Numbered document — generated up-front so delivery transactions can
  // reference the purchase number in their notes.
  const purchaseNumber = await getNextPurchaseNumber();

  // Optional payment info at creation (validated against the computed total).
  let paidAmount = 0;
  let paymentMethod: 'cash' | 'transfer' | 'check' | null = null;
  let account: MoneyAccount | null = null;
  let payments: IPurchase['payments'] = [];

  if (input.payments && input.payments.length > 0) {
    // New itemised shape: one line per method, all sharing a groupId. Takes
    // precedence over the legacy paymentMethod/paidAmount/account trio.
    const total = sumLines(input.payments);
    if (total > totalCost + 0.005) {
      throw new AppError('paidAmount cannot exceed total cost', 400);
    }
    const groupId = randomUUID();
    const date = new Date();
    payments = input.payments.map((line) => ({
      method: line.method,
      account: line.account ?? accountForMethod(line.method),
      amount: line.amount,
      date,
      groupId,
      ...(line.reference ? { reference: line.reference } : {})
    }));
    paidAmount = total;
    // Back-compat scalars reflect the LAST line of the recorded action.
    const last = input.payments[input.payments.length - 1]!;
    paymentMethod = last.method;
    account = last.account ?? accountForMethod(last.method);
  } else if (input.paidAmount !== undefined) {
    // Legacy single-payment shape — behaviour unchanged.
    if (input.paidAmount > totalCost) {
      throw new AppError('paidAmount cannot exceed total cost', 400);
    }
    paidAmount = input.paidAmount;
    paymentMethod = input.paymentMethod ?? null;
    // The whole paidAmount is attributed to one account: explicit override
    // wins, otherwise derived from the payment method.
    account = input.account ?? (paymentMethod ? accountForMethod(paymentMethod) : null);
  }

  const purchase = await Purchase.create({
    purchaseNumber,
    supplierId: supplier._id,
    date: input.date,
    items,
    duplicateFingerprint,
    totalCost,
    notes: input.notes ?? '',
    status: 'pending',
    deliveredAt: null,
    paymentMethod,
    account,
    paymentStatus: paymentStatusOf(paidAmount, totalCost),
    paidAmount,
    payments,
    createdBy: userId
  });

  if (input.delivered) {
    try {
      await applyDelivery(purchase, userId);
    } catch (error) {
      // applyDelivery already compensated stock/cost. The purchase document is
      // the only home of its payment lines, so deleting it also removes the
      // phantom cash outflow. The purchase number survives in the compensating
      // transaction notes.
      await Purchase.deleteOne({ _id: purchase._id });
      throw error;
    }
  }

  return purchase;
};

// ─── Delivery (stock entry point) ───────────────────────────────────────────

/** Pre-write state needed to undo a partially applied delivery. */
interface ProductSnapshot {
  productId: Types.ObjectId;
  previousQuantity: number;
  /** false → the delivery created the record; rollback must delete it. */
  hadInventory: boolean;
  previousCostPrice: number | null;
}

/** One item increment that actually reached the database. */
interface AppliedIncrement {
  productId: Types.ObjectId;
  quantityMaples: number;
}

/**
 * Test seam: lets a test force a failure after a given item has been applied
 * (production callers never pass hooks).
 */
export interface DeliveryApplyHooks {
  afterItemApplied?: (index: number) => void | Promise<void>;
}

/**
 * Undoes a partially applied delivery. Every snapshotted product is restored
 * to its exact pre-write state (restoring an untouched product is a no-op):
 *  - records that already existed get their previous quantity back;
 *  - records the delivery created on first entry are DELETED, so a failed
 *    delivery leaves no trace at all.
 * The cost price is always restored, and one compensating `adjustment`
 * transaction is appended per applied item so the append-only ledger still
 * explains the net-zero movement.
 */
const restoreDelivery = async (
  purchase: IPurchase,
  applied: AppliedIncrement[],
  snapshots: Map<string, ProductSnapshot>,
  userId: string
): Promise<void> => {
  for (const snapshot of snapshots.values()) {
    if (snapshot.hadInventory) {
      await Inventory.updateOne(
        { productId: snapshot.productId },
        { quantity: snapshot.previousQuantity, lastUpdated: new Date() }
      );
    } else {
      await Inventory.deleteOne({ productId: snapshot.productId });
    }
    await Product.updateOne(
      { _id: snapshot.productId },
      { costPrice: snapshot.previousCostPrice }
    );
  }

  for (const entry of applied) {
    await StockTransaction.create({
      productId: new Types.ObjectId(entry.productId.toString()),
      type: 'adjustment',
      quantity: -entry.quantityMaples,
      notes: `Reversión entrega de compra ${purchase.purchaseNumber}`,
      createdBy: userId
    });
  }
};

/**
 * Marks a purchase delivered: sets `deliveredAt` and increments inventory
 * (`quantityMaples` per item, 'purchase' transaction) + refreshes the product's
 * cost using a WEIGHTED AVERAGE COST (WAC) per maple. This is the ONLY place
 * purchase stock enters. Products without an Inventory record get one created
 * by the first increment; that initial quantity is 0 for WAC purposes.
 *
 * WAC (per maple, over the stock that existed BEFORE this delivery):
 *   newCost = round2((stockQty * stockCost + inQty * inCost) / (stockQty + inQty))
 *
 * Fresh-cost fallback — when there is no usable prior state (no stock, no prior
 * cost, or a non-positive resulting quantity) the product simply takes this
 * purchase's per-maple cost.
 *
 * Atomicity: every product is snapshotted BEFORE the first write. If any step
 * throws (including the final status save), `restoreDelivery` compensates all
 * applied items and the original error is rethrown. `status: 'delivered'` is
 * only persisted after every item succeeded.
 */
export const applyDelivery = async (
  purchase: IPurchase,
  userId: string,
  hooks?: DeliveryApplyHooks
): Promise<void> => {
  // 1. Snapshot each product exactly once, before touching anything.
  const snapshots = new Map<string, ProductSnapshot>();
  const running = new Map<string, { quantity: number; costPrice: number | null }>();

  for (const item of purchase.items) {
    const key = item.productId.toString();
    if (snapshots.has(key)) continue;

    const inventory = await Inventory.findOne({ productId: item.productId });
    const product = await Product.findOne({ _id: item.productId });
    if (!product) {
      throw new AppError(`Product not found: ${key}`, 404);
    }

    // A missing record is not an error: `incrementStock` creates it on first
    // entry. Its pre-delivery quantity is 0 both for WAC and for rollback.
    const previousQuantity = inventory?.quantity ?? 0;
    const previousCostPrice = product.costPrice ?? null;
    snapshots.set(key, {
      productId: item.productId,
      previousQuantity,
      hadInventory: inventory !== null,
      previousCostPrice
    });
    running.set(key, { quantity: previousQuantity, costPrice: previousCostPrice });
  }

  // 2. Apply. Track every increment that reached the DB so it can be undone.
  const applied: AppliedIncrement[] = [];
  try {
    for (let index = 0; index < purchase.items.length; index += 1) {
      const item = purchase.items[index]!;
      const key = item.productId.toString();
      const state = running.get(key)!;

      const inQty = item.quantityMaples;
      const inCost = item.unitCostPerMaple;
      const newQty = state.quantity + inQty;
      const newCost =
        state.costPrice == null || state.quantity <= 0 || newQty <= 0
          ? inCost
          : round2((state.quantity * state.costPrice + inQty * inCost) / newQty);

      await incrementStock(
        key,
        inQty,
        `Compra ${purchase.purchaseNumber} (${item.productName})`,
        userId,
        'purchase',
        purchase._id.toString()
      );
      // Record immediately: even if the cost update below throws, this
      // quantity must be compensated.
      applied.push({ productId: item.productId, quantityMaples: inQty });

      await Product.updateOne({ _id: item.productId }, { costPrice: newCost });
      state.quantity = newQty;
      state.costPrice = newCost;

      await hooks?.afterItemApplied?.(index);
    }

    // 3. Only now is the purchase marked delivered.
    purchase.status = 'delivered';
    purchase.deliveredAt = new Date();
    await purchase.save();
  } catch (error) {
    try {
      await restoreDelivery(purchase, applied, snapshots, userId);
    } catch (compensationError) {
      // Never mask the original delivery failure with a compensation error;
      // surface it for operators instead.
      console.error('[purchases] delivery compensation failed', compensationError);
    }
    throw error;
  }
};

/** PATCH /:id/deliver — pending → delivered (409 on any other state). */
export const deliverPurchase = async (id: string, userId: string): Promise<IPurchase> => {
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw new AppError('Purchase not found', 404);
  }
  if (purchase.status !== 'pending') {
    throw new AppError(
      purchase.status === 'delivered' ? 'Purchase already delivered' : 'Cannot deliver a cancelled purchase',
      409
    );
  }
  // Validate before writing: a later retry must apply exactly once, with no
  // partial stock movement or cost change from the failed attempt.
  await validateDeliveryItems(purchase.items);
  await applyDelivery(purchase, userId);
  return purchase;
};

// ─── Cancel ─────────────────────────────────────────────────────────────────

/** PATCH /:id/cancel — pending → cancelled (409 on any other state). */
export const cancelPurchase = async (id: string): Promise<IPurchase> => {
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw new AppError('Purchase not found', 404);
  }
  if (purchase.status !== 'pending') {
    throw new AppError(
      purchase.status === 'delivered' ? 'Cannot cancel a delivered purchase' : 'Purchase already cancelled',
      409
    );
  }
  purchase.status = 'cancelled';
  await purchase.save();
  return purchase;
};

// ─── Edit (pending only) ────────────────────────────────────────────────────

/**
 * PATCH /:id — edits supplierId/date/items/notes of a PENDING purchase and
 * recomputes totals. No stock impact (nothing entered stock yet). Delivered or
 * cancelled purchases are 409.
 */
export const updatePurchase = async (id: string, input: UpdatePurchaseInput): Promise<IPurchase> => {
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw new AppError('Purchase not found', 404);
  }
  if (purchase.status !== 'pending') {
    throw new AppError('Cannot edit a purchase that is not pending', 409);
  }

  if (input.supplierId !== undefined) {
    const supplier = await Supplier.findById(input.supplierId);
    if (!supplier) {
      throw new AppError('Supplier not found', 404);
    }
    if (!supplier.active) {
      throw new AppError('Cannot register purchase for inactive supplier', 409);
    }
    purchase.supplierId = supplier._id;
  }
  if (input.date !== undefined) {
    purchase.date = input.date;
  }
  if (input.notes !== undefined) {
    purchase.notes = input.notes;
  }
  if (input.items !== undefined) {
    const items = await buildItems(input.items);
    const newTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    // Money already paid is immutable history: reducing the total below it
    // would orphan the overpayment (Caja keeps attributing the payment lines
    // while the purchase would report a smaller paidAmount). Reject instead of
    // silently clamping; the record is left untouched.
    if (newTotal < purchase.paidAmount) {
      throw new AppError(
        `No se puede bajar el total ($${newTotal}) por debajo de lo ya pagado ($${purchase.paidAmount})`,
        409
      );
    }
    purchase.items = items as IPurchase['items'];
    purchase.totalCost = newTotal;
    purchase.paymentStatus = paymentStatusOf(purchase.paidAmount, newTotal);
  }

  await purchase.save();
  return purchase;
};

// ─── Payments ───────────────────────────────────────────────────────────────

/**
 * PATCH /:id/payment — records one or MORE payment lines against the purchase.
 * Accepts the itemised `{ payments: [...] }` shape (one line per method, all
 * sharing a groupId) or the legacy single `{ method, amount }` shape (treated
 * as a 1-line array). Guards: not cancelled; Σ(amount) ≤ balance with a 0.005
 * epsilon (totalCost − paidAmount). Appends one `payments` entry per line,
 * accumulates `paidAmount` and recomputes `paymentStatus`. The scalar
 * `paymentMethod`/`account` are kept in sync with the LAST line for back-compat.
 */
export const recordPayment = async (id: string, input: RecordPaymentInput): Promise<IPurchase> => {
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw new AppError('Purchase not found', 404);
  }
  if (purchase.status === 'cancelled') {
    throw new AppError('Cannot record a payment on a cancelled purchase', 409);
  }

  const lines = normalizePaymentLines(input);
  if (lines.length === 0) {
    throw new AppError('Amount exceeds the remaining balance', 400);
  }

  const total = sumLines(lines);
  const balance = purchase.totalCost - purchase.paidAmount;
  // Epsilon absorbs floating-point noise so paying the exact balance passes.
  if (total > balance + 0.005) {
    throw new AppError('Amount exceeds the remaining balance', 400);
  }

  const groupId = input.groupId ?? randomUUID();
  const date = new Date();
  if (!purchase.payments) purchase.payments = [];
  for (const line of lines) {
    purchase.payments.push({
      method: line.method,
      account: line.account ?? accountForMethod(line.method),
      amount: line.amount,
      date,
      groupId,
      ...(line.reference ? { reference: line.reference } : {})
    });
  }

  purchase.paidAmount = round2(purchase.paidAmount + total);
  // Back-compat scalars mirror the last recorded line.
  const last = lines[lines.length - 1]!;
  purchase.paymentMethod = last.method;
  purchase.account = last.account ?? accountForMethod(last.method);
  purchase.paymentStatus = paymentStatusOf(purchase.paidAmount, purchase.totalCost);
  await purchase.save();
  return purchase;
};

// ─── List / detail ───────────────────────────────────────────────────────────

export interface PurchaseListFilters {
  supplierId?: string;
  from?: Date;
  to?: Date;
  status?: 'pending' | 'delivered' | 'cancelled';
}

/**
 * Lists purchases sorted by date desc (newest first). Supports optional
 * `supplierId` filter, an inclusive `from`/`to` date range on `purchase.date`,
 * and a `status` filter.
 */
export const listPurchases = async (filters: PurchaseListFilters = {}): Promise<IPurchase[]> => {
  const query: Record<string, unknown> = {};

  if (filters.supplierId) {
    query.supplierId = new Types.ObjectId(filters.supplierId);
  }

  if (filters.from || filters.to) {
    // Snap the range to whole local days so the last day is inclusive and
    // noon-anchored (business-date) values are not excluded.
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.$gte = startOfCalendarDay(filters.from);
    if (filters.to) dateFilter.$lte = endOfCalendarDay(filters.to);
    query.date = dateFilter;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  return Purchase.find(query)
    .populate('supplierId', 'name contact phone')
    .sort({ date: -1, createdAt: -1 });
};

export interface PurchaseItemWithMargin {
  productId: string;
  productName: string;
  /** Unit the item was bought in: 'maple' (default), 'medio_cajon' or 'cajon'. */
  unit: ProductUnit;
  /** Quantity as entered, in the item's own unit. */
  quantity: number;
  quantityMaples: number;
  /** Unit cost as entered — per maple, per medio cajón or per cajón. */
  unitCost: number;
  /** Cost per maple (unit cost ÷ maples in that unit). */
  unitCostPerMaple: number;
  subtotal: number;
  /** activePrice (maple) − unitCostPerMaple; null when no active price. */
  margin: number | null;
}

export interface PurchasePaymentEntry {
  method: 'cash' | 'transfer' | 'check';
  account: MoneyAccount;
  amount: number;
  date: Date;
  /** Shared by all lines recorded in the same "pago" action. */
  groupId: string;
  reference?: string;
}

export interface PurchaseDetail {
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  date: Date;
  items: PurchaseItemWithMargin[];
  totalCost: number;
  notes: string;
  status: 'pending' | 'delivered' | 'cancelled';
  deliveredAt: Date | null;
  paymentMethod: 'cash' | 'transfer' | 'check' | null;
  /** Money account the paidAmount is attributed to (null = unpaid). */
  account: MoneyAccount | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paidAmount: number;
  /** Itemised payment history (empty for legacy docs without lines). */
  payments: PurchasePaymentEntry[];
  /** totalCost − paidAmount (computed, not stored). */
  balance: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Returns a purchase detail with per-item margin (active price − unit cost)
 * plus lifecycle + payment fields. `margin` is null when the product has no
 * active price at the current date.
 */
export const getPurchaseById = async (id: string): Promise<PurchaseDetail> => {
  const purchase = await Purchase.findById(id).populate('supplierId', 'name contact phone');
  if (!purchase) {
    throw new AppError('Purchase not found', 404);
  }

  // supplierId is populated (object) — fall back to the raw ObjectId string
  const supplier = purchase.supplierId as unknown as { _id: Types.ObjectId; name: string } | null;
  const supplierId = supplier?._id ? supplier._id.toString() : String(purchase.supplierId);
  const supplierName = supplier?.name ?? '';

  const items: PurchaseItemWithMargin[] = [];
  for (const item of purchase.items) {
    // Legacy purchases (pre-unit) have no `unit`/`quantity`/`unitCostPerMaple` —
    // they were always maple, so quantity = quantityMaples and per-maple cost = unitCost.
    const unit = item.unit ?? 'maple';
    const quantity = item.quantity ?? item.quantityMaples;
    const unitCostPerMaple = item.unitCostPerMaple ?? item.unitCost;

    let margin: number | null = null;
    try {
      const activePrice = await getActivePrice(item.productId.toString());
      margin = activePrice.price - unitCostPerMaple;
    } catch {
      margin = null; // no active price → margin unknown, not an error
    }
    items.push({
      productId: item.productId.toString(),
      productName: item.productName,
      unit,
      quantity,
      quantityMaples: item.quantityMaples,
      unitCost: item.unitCost,
      unitCostPerMaple,
      subtotal: item.subtotal,
      margin
    });
  }

  return {
    purchaseNumber: purchase.purchaseNumber,
    supplierId,
    supplierName,
    date: purchase.date,
    items,
    totalCost: purchase.totalCost,
    notes: purchase.notes,
    status: purchase.status,
    deliveredAt: purchase.deliveredAt ?? null,
    paymentMethod: purchase.paymentMethod ?? null,
    account: purchase.account ?? null,
    paymentStatus: purchase.paymentStatus,
    paidAmount: purchase.paidAmount,
    // Legacy docs have no `payments` array → empty history (their whole
    // paidAmount is attributed via the scalar account at dashboard time).
    payments: (purchase.payments ?? []).map((line) => ({
      method: line.method,
      account: line.account ?? accountForMethod(line.method),
      amount: line.amount,
      date: line.date,
      groupId: line.groupId,
      ...(line.reference ? { reference: line.reference } : {})
    })),
    balance: purchase.totalCost - purchase.paidAmount,
    createdBy: purchase.createdBy,
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt
  };
};

// ─── Delete (pending / cancelled only) ──────────────────────────────────────

/**
 * Deletes a purchase. Allowed ONLY when pending or cancelled AND no money has
 * moved against it — neither state has touched stock (stock enters at delivery),
 * so no stock reversal is needed.
 *
 * A purchase with payments must NOT be deleted: its payment lines are the only
 * record of the cash outflow, and `buildPurchaseMovements` keeps counting them
 * from the document. Deleting it would make the money silently disappear from
 * Caja/cash movements/`cajaHoy`. Cancelling preserves `paidAmount`/lines, so the
 * outflow stays visible. Delivered purchases are 409 too.
 */
export const deletePurchase = async (id: string): Promise<void> => {
  const purchase = await Purchase.findById(id);
  if (!purchase) {
    throw new AppError('Purchase not found', 404);
  }
  if (purchase.status === 'delivered') {
    throw new AppError('Cannot delete a delivered purchase', 409);
  }
  if (purchase.paidAmount > 0 || (purchase.payments?.length ?? 0) > 0) {
    throw new AppError(
      'No se puede eliminar una compra con pagos registrados. Cancelala para conservar el movimiento de caja.',
      409
    );
  }

  await Purchase.deleteOne({ _id: purchase._id });
};