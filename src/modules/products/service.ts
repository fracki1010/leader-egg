import { AppError } from '../../middleware/error-handler.js';
import { Product, displayName, type IProduct } from './model.js';
import { PriceEntry, type IPriceEntry, type PriceUnit } from './price-list-model.js';
import { unitToMaples, DEFAULT_MAPLES_PER_CAJON } from './units.js';
import { createInventoryRecord } from '../inventory/service.js';
import type { CreateProductInput, CreatePriceEntryInput, UpdateProductInput, ListProductsQuery } from './schema.js';

// ─── Product operations ─────────────────────────────────────────────────────

/**
 * List products, optionally filtered by variety (name) and/or caliber.
 * Sorted by variety then caliber so the UI can group by variety.
 */
export const listProducts = async (filters?: ListProductsQuery): Promise<IProduct[]> => {
  const query: Record<string, unknown> = {};
  if (filters?.variety) query.variety = filters.variety;
  if (filters?.caliber) query.caliber = filters.caliber;

  return Product.find(query).sort({ variety: 1, caliber: 1 });
};

export const getProductById = async (id: string): Promise<IProduct> => {
  const product = await Product.findById(id);
  if (!product) {
    throw new AppError('Product not found', 404);
  }
  return product;
};

export const createProduct = async (input: CreateProductInput): Promise<IProduct> => {
  // Validate unique (variety, caliber) — the compound index is the hard guard,
  // this check gives a clean 409 message instead of a Mongo duplicate-key error.
  const duplicate = await Product.findOne({ variety: input.variety, caliber: input.caliber });
  if (duplicate) {
    throw new AppError(
      `Product already exists: ${displayName(input)}`,
      409
    );
  }

  const product = await Product.create({
    variety: input.variety,
    caliber: input.caliber,
    eggsPerMaple: input.eggsPerMaple ?? 30,
    maplesPerCajon: input.maplesPerCajon ?? 12,
    costPrice: input.costPrice ?? null,
    lowStockThreshold: input.lowStockThreshold ?? 20
  });

  // Auto-create inventory record for the new product (with optional opening stock).
  await createInventoryRecord(product._id.toString(), input.initialQuantity ?? 0);

  return product;
};

export const updateProduct = async (
  id: string,
  input: UpdateProductInput
): Promise<IProduct> => {
  const product = await Product.findById(id);
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // If variety or caliber is changing, verify the new combo doesn't collide.
  const newVariety = input.variety ?? product.variety;
  const newCaliber = input.caliber ?? product.caliber;
  if (input.variety !== undefined || input.caliber !== undefined) {
    const clash = await Product.findOne({
      _id: { $ne: id },
      variety: newVariety,
      caliber: newCaliber
    });
    if (clash) {
      throw new AppError(
        `Product already exists: ${displayName({ variety: newVariety, caliber: newCaliber })}`,
        409
      );
    }
  }

  if (input.variety !== undefined) product.variety = input.variety;
  if (input.caliber !== undefined) product.caliber = input.caliber;
  if (input.costPrice !== undefined) product.costPrice = input.costPrice;
  if (input.maplesPerCajon !== undefined) product.maplesPerCajon = input.maplesPerCajon;
  if (input.lowStockThreshold !== undefined) product.lowStockThreshold = input.lowStockThreshold;
  await product.save();

  return product;
};

export const deleteProduct = async (id: string): Promise<void> => {
  const product = await Product.findByIdAndDelete(id);
  if (!product) {
    throw new AppError('Product not found', 404);
  }
};

// ─── Price list operations ──────────────────────────────────────────────────

export const listPricesByProduct = async (productId: string): Promise<IPriceEntry[]> => {
  // Verify product exists
  await getProductById(productId);

  return PriceEntry.find({ productId })
    .sort({ effectiveFrom: -1 });
};

/**
 * Unit scoping for overlap lookups. Mirrors the model's pre-save hook:
 * 'maple' also matches legacy docs that predate the `unit` field, while any
 * explicit non-maple unit (medio_cajon, cajon) only collides with itself.
 */
const unitFilter = (unit: PriceUnit): Record<string, unknown> =>
  unit === 'maple'
    ? { $or: [{ unit: 'maple' }, { unit: { $exists: false } }] }
    : { unit };

/**
 * Finds the existing price entries for a `(productId, unit)` whose inclusive
 * date ranges overlap `[newFrom, newTo]` (`newTo === null` means open-ended).
 * Mirrors the model's overlap predicate so the service can supersede previous
 * prices BEFORE inserting, instead of letting the pre-save hook reject them.
 */
const findOverlappingEntries = async (
  productId: string,
  unit: PriceUnit,
  newFrom: Date,
  newTo: Date | null
): Promise<IPriceEntry[]> => {
  const dateConditions: Record<string, unknown>[] = [
    { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: newFrom } }] }
  ];
  if (newTo) {
    dateConditions.push({ effectiveFrom: { $lte: newTo } });
  }

  return PriceEntry.find({
    productId,
    $and: [unitFilter(unit), ...dateConditions]
  });
};

/**
 * Creates a price entry, superseding overlapping entries for the same
 * `(productId, unit)` instead of rejecting them with a 409:
 *
 * - an overlapping entry that starts strictly BEFORE the new effective start is
 *   CLOSED (`effectiveTo = newFrom - 1ms`, keeping the inclusive ranges disjoint);
 * - an overlapping entry that starts at/after the new start — the common
 *   "I just re-saved the same price" case — is UPDATED IN PLACE and returned,
 *   so no duplicate entry or zero-length window is created;
 * - more than one entry to replace, or a mix of both kinds, is a genuine
 *   conflict and still returns the existing 409 overlap error.
 *
 * The model's pre-save hook remains the last line of defense for direct
 * `PriceEntry.create`/updates; closing entries before the new insert is what
 * lets the insert succeed.
 */
export const createPriceEntry = async (
  productId: string,
  input: CreatePriceEntryInput
): Promise<IPriceEntry> => {
  // Verify product exists
  await getProductById(productId);

  // Validate effectiveTo is after effectiveFrom (belt-and-suspenders with Zod)
  if (input.effectiveTo !== null && input.effectiveTo <= input.effectiveFrom) {
    throw new AppError('effectiveTo must be after effectiveFrom', 400);
  }

  const unit = input.unit ?? 'maple';
  const newFrom = input.effectiveFrom;
  const newTo = input.effectiveTo ?? null;

  const overlapping = await findOverlappingEntries(productId, unit, newFrom, newTo);

  if (overlapping.length > 0) {
    const previous = overlapping.filter((entry) => entry.effectiveFrom < newFrom);
    const sameStart = overlapping.filter((entry) => entry.effectiveFrom >= newFrom);

    // Anything we cannot resolve by closing exactly one predecessor or by
    // re-saving exactly one same-start entry is a genuine conflict.
    if (sameStart.length > 1 || (sameStart.length === 1 && previous.length > 0)) {
      throw new AppError('Price date ranges must not overlap for the same product and unit', 409);
    }

    if (sameStart.length === 1) {
      // Re-saving the same effective start → update in place, no second entry.
      const entry = sameStart[0]!;
      entry.price = input.price;
      entry.effectiveTo = newTo;
      await entry.save();
      return entry;
    }

    // Only predecessor(s) overlap: close them 1ms before the new start so the
    // inclusive ranges stay disjoint and the model hook accepts the insert.
    const closesAt = new Date(newFrom.getTime() - 1);
    for (const entry of previous) {
      entry.effectiveTo = closesAt;
      await entry.save();
    }
  }

  // Create the price entry — overlap validation runs in the model pre-save hook
  const entry = await PriceEntry.create({
    productId,
    price: input.price,
    unit,
    effectiveFrom: newFrom,
    effectiveTo: newTo
  });

  return entry;
};

/**
 * Find the active price for a product + unit at a given date.
 * Returns the price entry where effectiveFrom <= date AND (effectiveTo is null OR effectiveTo >= date).
 * Legacy entries without a `unit` field are treated as 'maple'.
 */
export const getActivePrice = async (
  productId: string,
  unit: PriceUnit = 'maple',
  date: Date = new Date()
): Promise<IPriceEntry> => {
  // 'maple' also matches legacy docs without a `unit` field; every other unit
  // (medio_cajon, cajon) resolves strictly by its own explicit value.
  const unitFilter: Record<string, unknown> = unit === 'maple'
    ? { $or: [{ unit: 'maple' }, { unit: { $exists: false } }] }
    : { unit };

  const dateFilter = [
    { effectiveTo: null },
    { effectiveTo: { $gte: date } }
  ];

  const entry = await PriceEntry.findOne({
    productId,
    effectiveFrom: { $lte: date },
    $and: [unitFilter, { $or: dateFilter }]
  }).sort({ effectiveFrom: -1 });

  if (!entry) {
    throw new AppError(`No active price for product (${unit}) on ${date.toISOString()}`, 404);
  }

  return entry;
};

/**
 * Convert a quantity in the item's unit to maples — the single source of
 * truth for unit → maple conversion (design D6). Delegates to the shared
 * `unitToMaples` helper in ./units.ts. Maple quantities pass through unchanged.
 */
export const convertToMaples = (
  product: { maplesPerCajon?: number },
  qty: number,
  unit: PriceUnit = 'maple'
): number => unitToMaples(qty, unit, product.maplesPerCajon ?? DEFAULT_MAPLES_PER_CAJON);
