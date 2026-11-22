import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError, InsufficientStockError } from '../../middleware/error-handler.js';
import { Inventory, type IInventory } from './model.js';
import { StockTransaction, type ITransaction } from './transaction-model.js';
import { Product, type IProduct } from '../products/model.js';

// ─── Inventory queries ──────────────────────────────────────────────────────

export const getInventory = async (): Promise<IInventory[]> => {
  return Inventory.find().populate('productId', 'variety caliber lowStockThreshold');
};

export const getInventoryByProduct = async (productId: string): Promise<IInventory> => {
  const record = await Inventory.findOne({ productId }).populate('productId', 'variety caliber lowStockThreshold');
  if (!record) {
    throw new AppError('Inventory record not found', 404);
  }
  return record;
};

// ─── Stock mutations ────────────────────────────────────────────────────────

/**
 * Ensures the referenced product exists. A stock mutation is only meaningful
 * for a real product: without this guard an upsert would happily create an
 * orphan Inventory record for an arbitrary ObjectId.
 */
const assertProductExists = async (productId: string): Promise<void> => {
  if (!Types.ObjectId.isValid(productId) || !(await Product.exists({ _id: productId }))) {
    throw new AppError(`Product not found: ${productId}`, 404);
  }
};

/**
 * Absolute stock adjustment (PATCH /v1/inventory/:productId). Creates the
 * Inventory record on the fly when the product has none yet: the previous
 * quantity is then 0, so the logged adjustment delta is the whole quantity.
 */
export const adjustStock = async (
  productId: string,
  quantity: number,
  notes: string,
  userId: string
): Promise<IInventory> => {
  await assertProductExists(productId);

  const previous = await Inventory.findOne({ productId }).select('quantity');
  const previousQuantity = previous?.quantity ?? 0;
  const delta = quantity - previousQuantity;

  const record = await Inventory.findOneAndUpdate(
    { productId },
    { $set: { quantity, lastUpdated: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // An upsert always yields a document; treat a null as an internal error.
  if (!record) {
    throw new AppError('Inventory record could not be upserted', 500);
  }

  await StockTransaction.create({
    productId: new Types.ObjectId(productId),
    type: 'adjustment',
    quantity: delta,
    notes,
    createdBy: userId
  });

  return record;
};

/**
 * Removes stock with an atomic `$gte` guard so it can never go below zero.
 * A missing record is treated as 0 available, so selling a product that never
 * received stock fails as InsufficientStockError (409, available: 0) instead of
 * surfacing "Inventory record not found".
 */
export const decrementStock = async (
  productId: string,
  quantity: number,
  orderId: string,
  userId: string,
  notes: string = 'Delivery decrement'
): Promise<IInventory> => {
  const updated = await Inventory.findOneAndUpdate(
    { productId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity }, lastUpdated: new Date() },
    { new: true }
  );

  if (!updated) {
    const current = await Inventory.findOne({ productId });
    throw new InsufficientStockError(productId, quantity, current?.quantity ?? 0);
  }

  await StockTransaction.create({
    productId: new Types.ObjectId(productId),
    type: 'delivery',
    quantity: -quantity,
    orderId: new Types.ObjectId(orderId),
    notes,
    createdBy: userId
  });

  return updated;
};

/**
 * Manual stock exit (sale/manual adjustment) with an atomic $gte guard so
 * stock can never go below zero. Logs an 'adjustment' transaction with a
 * negative quantity (keeps the transaction type enum stable).
 */
export const decrementStockManual = async (
  productId: string,
  quantity: number,
  notes: string,
  userId: string
): Promise<IInventory> => {
  const updated = await Inventory.findOneAndUpdate(
    { productId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity }, lastUpdated: new Date() },
    { new: true }
  );

  if (!updated) {
    const current = await Inventory.findOne({ productId });
    if (!current) {
      throw new AppError('Inventory record not found', 404);
    }
    throw new InsufficientStockError(productId, quantity, current.quantity);
  }

  await StockTransaction.create({
    productId: new Types.ObjectId(productId),
    type: 'adjustment',
    quantity: -quantity,
    notes,
    createdBy: userId
  });

  return updated;
};

/**
 * Adds stock (purchase, return or a compensating reversal). The Inventory
 * record is UPSERTED: entering stock for a product whose record does not exist
 * yet creates it on the fly, with the incremented quantity as its first value.
 */
export const incrementStock = async (
  productId: string,
  quantity: number,
  notes: string,
  userId: string,
  type: ITransaction['type'] = 'purchase',
  purchaseId?: string,
  orderId?: string
): Promise<IInventory> => {
  await assertProductExists(productId);

  const updated = await Inventory.findOneAndUpdate(
    { productId },
    { $inc: { quantity }, lastUpdated: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // An upsert always yields a document; treat a null as an internal error.
  if (!updated) {
    throw new AppError('Inventory record could not be upserted', 500);
  }

  await StockTransaction.create({
    productId: new Types.ObjectId(productId),
    type,
    quantity,
    ...(purchaseId ? { purchaseId: new Types.ObjectId(purchaseId) } : {}),
    ...(orderId ? { orderId: new Types.ObjectId(orderId) } : {}),
    notes,
    createdBy: userId
  });

  return updated;
};

// ─── Classify (surtido classification) ───────────────────────────────────────

export interface ClassifyTarget {
  productId: string;
  quantity: number;
}

export interface ClassifyResult {
  source: IInventory;
  targets: IInventory[];
  referenceId: string;
}

/**
 * Classify a mixed-purchase product into typed products (e.g. "Surtido sin
 * clasificar" → Blanco/Castaño/Grande). Quantities are maples — the inventory
 * unit — so no conversion happens at classify time.
 *
 * Validation runs BEFORE any write so a failure leaves nothing persisted:
 * unknown source/target product → 404, missing inventory record → 404,
 * non-positive target quantity or self-classification → 400, Σ to exceeding
 * the source → 400 "No hay stock suficiente". The source decrement then uses
 * the same atomic $gte guard as deliveries, so stock can never go negative
 * (a concurrent drain between validation and write also surfaces as 400).
 * Every transaction created shares one `referenceId` (`classify-{uuid}`) so
 * the whole action is traceable in the append-only ledger.
 */
export const classifyInventory = async (
  fromProductId: string,
  to: ClassifyTarget[],
  notes: string | undefined,
  userId: string
): Promise<ClassifyResult> => {
  if (!Array.isArray(to) || to.length === 0) {
    throw new AppError('to must be a non-empty array', 400);
  }

  for (const entry of to) {
    if (entry.productId === fromProductId) {
      throw new AppError('No se puede clasificar un producto hacia sí mismo', 400);
    }
    if (typeof entry.quantity !== 'number' || !Number.isFinite(entry.quantity) || entry.quantity <= 0) {
      throw new AppError('quantity must be greater than 0', 400);
    }
  }

  // Unknown source product → 404 (invalid ObjectIds included).
  if (!Types.ObjectId.isValid(fromProductId)) {
    throw new AppError('Product not found', 404);
  }
  const sourceExists = await Product.exists({ _id: fromProductId });
  if (!sourceExists) {
    throw new AppError('Product not found', 404);
  }

  // Every target product must exist → 404 (nothing persisted). The set
  // dedupes repeated target ids so a product listed twice still passes.
  const targetIds = [...new Set(to.map((entry) => entry.productId))];
  const validTargetIds = targetIds.filter((id) => Types.ObjectId.isValid(id));
  const found = await Product.countDocuments({ _id: { $in: validTargetIds } });
  if (found !== validTargetIds.length) {
    throw new AppError('Product not found', 404);
  }

  // Source and target inventory records must exist up-front so the write
  // phase cannot fail halfway through (the source decrement is the first
  // write and must stay the only failure point for stock reasons).
  const sourceRecord = await Inventory.findOne({ productId: fromProductId });
  if (!sourceRecord) {
    throw new AppError('Inventory record not found', 404);
  }

  const missingTarget = await Inventory.countDocuments({
    productId: { $in: validTargetIds }
  });
  if (missingTarget !== validTargetIds.length) {
    throw new AppError('Inventory record not found', 404);
  }

  const total = to.reduce((sum, entry) => sum + entry.quantity, 0);
  if (total > sourceRecord.quantity) {
    throw new AppError('No hay stock suficiente', 400);
  }

  // Execute — decrement the source atomically first, then increment targets.
  const referenceId = `classify-${randomUUID()}`;

  const source = await Inventory.findOneAndUpdate(
    { productId: fromProductId, quantity: { $gte: total } },
    { $inc: { quantity: -total }, lastUpdated: new Date() },
    { new: true }
  );
  if (!source) {
    // Stock drained by a concurrent operation after validation.
    throw new AppError('No hay stock suficiente', 400);
  }

  const targets: IInventory[] = [];
  for (const entry of to) {
    const target = await Inventory.findOneAndUpdate(
      { productId: entry.productId },
      { $inc: { quantity: entry.quantity }, lastUpdated: new Date() },
      { new: true }
    );
    if (!target) {
      throw new AppError('Inventory record not found', 404);
    }
    targets.push(target);
  }

  const txnNotes = notes ?? 'Clasificación de surtido';
  await StockTransaction.create({
    productId: new Types.ObjectId(fromProductId),
    type: 'classification',
    quantity: -total,
    referenceId,
    notes: txnNotes,
    createdBy: userId
  });

  for (const entry of to) {
    await StockTransaction.create({
      productId: new Types.ObjectId(entry.productId),
      type: 'classification',
      quantity: entry.quantity,
      referenceId,
      notes: txnNotes,
      createdBy: userId
    });
  }

  return { source, targets, referenceId };
};

// ─── Transactions ───────────────────────────────────────────────────────────

export const getTransactions = async (productId: string): Promise<ITransaction[]> => {
  return StockTransaction.find({ productId }).sort({ createdAt: -1 });
};

export interface TransactionListFilters {
  productId?: string;
  type?: ITransaction['type'];
  from?: Date;
  to?: Date;
  limit: number;
  page: number;
}

export interface TransactionListResult {
  items: ITransaction[];
  total: number;
  page: number;
  limit: number;
}

export const listAllTransactions = async (
  filters: TransactionListFilters
): Promise<TransactionListResult> => {
  const query: Record<string, unknown> = {};

  if (filters.productId) {
    query.productId = new Types.ObjectId(filters.productId);
  }

  if (filters.type) {
    query.type = filters.type;
  }

  if (filters.from || filters.to) {
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.$gte = filters.from;
    if (filters.to) dateFilter.$lte = filters.to;
    query.createdAt = dateFilter;
  }

  const page = filters.page;
  const limit = filters.limit;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    StockTransaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    StockTransaction.countDocuments(query)
  ]);

  return { items, total, page, limit };
};

// ─── Inventory deletion ──────────────────────────────────────────────────────

export const deleteInventoryRecord = async (productId: string): Promise<void> => {
  const record = await Inventory.findOneAndDelete({ productId });
  if (!record) {
    throw new AppError('Inventory record not found', 404);
  }
};

// ─── Low stock threshold (stored on the Product) ─────────────────────────────

export const updateLowStockThreshold = async (
  productId: string,
  lowStockThreshold: number
): Promise<IProduct> => {
  const record = await Inventory.findOne({ productId });
  if (!record) {
    throw new AppError('Inventory record not found', 404);
  }

  const product = await Product.findByIdAndUpdate(
    productId,
    { lowStockThreshold },
    { new: true }
  );

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  return product;
};

// ─── Inventory creation (for product creation + seed) ───────────────────────

export const createInventoryRecord = async (
  productId: string,
  quantity: number = 0,
  options: { createdBy?: string } = {}
): Promise<IInventory> => {
  const existing = await Inventory.findOne({ productId });
  if (existing) {
    throw new AppError('Inventory record already exists for this product', 409);
  }

  const record = await Inventory.create({
    productId: new Types.ObjectId(productId),
    quantity,
    lastUpdated: new Date()
  });

  // Log initial stock as an adjustment transaction when seeded with quantity
  if (quantity > 0) {
    await StockTransaction.create({
      productId: new Types.ObjectId(productId),
      type: 'adjustment',
      quantity,
      notes: 'Initial stock',
      createdBy: options.createdBy ?? 'system'
    });
  }

  return record;
};

/**
 * Create an inventory record for a product via the API (POST /v1/inventory).
 * Verifies the product exists, optionally updates its low stock threshold,
 * and delegates record creation to `createInventoryRecord`.
 */
export const createInventoryForProduct = async (
  productId: string,
  quantity: number,
  lowStockThreshold: number | undefined,
  createdBy: string
): Promise<IInventory> => {
  const productExists = await Product.exists({ _id: productId });
  if (!productExists) {
    throw new AppError('Product not found', 404);
  }

  if (lowStockThreshold !== undefined) {
    await Product.updateOne({ _id: productId }, { lowStockThreshold });
  }

  return createInventoryRecord(productId, quantity, { createdBy });
};
