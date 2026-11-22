import { AppError } from '../../middleware/error-handler.js';
import { Promotion, type IPromotion, type PromotionStatus, type PromotionType } from './model.js';
import { Product } from '../products/model.js';
import { getActivePrice } from '../products/service.js';
import type { PriceUnit } from '../products/price-list-model.js';
import type { CreatePromotionInput, UpdatePromotionInput } from './schema.js';

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ─── Promo lifecycle ─────────────────────────────────────────────────────────

/**
 * A promo is active only when ALL of these hold (spec R2):
 *  - status === 'active'
 *  - no expiresAt OR expiresAt is still in the future
 *  - no stockLimit OR soldQuantity is still below the limit
 */
export const isPromoActive = (
  promo: Pick<IPromotion, 'status' | 'expiresAt' | 'stockLimit' | 'soldQuantity'>
): boolean => {
  if (promo.status !== 'active') return false;
  if (promo.expiresAt && promo.expiresAt.getTime() <= Date.now()) return false;
  if (promo.stockLimit != null && promo.soldQuantity >= promo.stockLimit) return false;
  return true;
};

// ─── Pricing ─────────────────────────────────────────────────────────────────

export interface PromoPricing {
  /** Effective per-unit price for the whole line (promo price for the line's unit). */
  unitPrice: number;
  /** Line subtotal. For buy_x_get_y only the paid units are charged. */
  subtotal: number;
}

/**
 * Applies a promotion to a base (active) unit price (spec R3):
 *  - fixed_price       → GROUP pricing: `value` is the price of a group of
 *                        `minQuantity` units (default 1). Full groups are
 *                        charged at the group price; any leftover units are
 *                        charged at the base price. unitPrice is the effective
 *                        per-unit average (subtotal / qty) so the line math
 *                        stays consistent.
 *  - discount_percent  → unitPrice = basePrice × (1 − value/100)
 *  - buy_x_get_y       → totalPerGroup = getQuantity ?? (value + 1); one unit
 *                        of every group is free (freeQty = floor(qty/totalPerGroup));
 *                        subtotal charges only the paid units and the effective
 *                        unit price spreads it across the full quantity.
 */
export const applyPromoPrice = (
  basePrice: number,
  promo: Pick<IPromotion, 'type' | 'value' | 'getQuantity' | 'minQuantity'>,
  qty: number
): PromoPricing => {
  switch (promo.type) {
    case 'fixed_price': {
      // Group pricing: the group size N is promo.minQuantity (default 1).
      // Full groups pay the group price (`value`); leftover units pay the base
      // price. unitPrice is the effective average so that unitPrice × qty ===
      // subtotal — this keeps resolveBestPromo's comparison by unit price valid.
      const groupSize = promo.minQuantity ?? 1;
      const groups = Math.floor(qty / groupSize);
      const leftover = qty % groupSize;
      const subtotal = round2(groups * promo.value + leftover * basePrice);
      const unitPrice = qty > 0 ? round2(subtotal / qty) : 0;
      return { unitPrice, subtotal };
    }
    case 'discount_percent': {
      const unitPrice = round2(basePrice * (1 - promo.value / 100));
      return { unitPrice, subtotal: round2(unitPrice * qty) };
    }
    case 'buy_x_get_y': {
      // "pagás X llevás Y": getQuantity is the TOTAL units per group. Legacy
      // promos (getQuantity null) keep "buy X get 1 free" → total = value + 1.
      const totalPerGroup = promo.getQuantity ?? promo.value + 1;
      const freeQty = Math.floor(qty / totalPerGroup);
      const paidQty = qty - freeQty;
      const subtotal = round2(paidQty * basePrice);
      return { unitPrice: round2(subtotal / qty), subtotal };
    }
  }
};

// ─── Resolution ──────────────────────────────────────────────────────────────

export interface PromoListFilters {
  status?: PromotionStatus;
  productId?: string;
}

export interface ActivePromoFilters {
  productId?: string;
  unit?: PriceUnit;
}

/**
 * Finds the most favorable (lowest effective unit price) active promo for a
 * product + unit at a given line quantity. A promo is eligible only when it is
 * active (status/expiry/stock) AND the quantity sits within min/max bounds.
 * Returns null when no eligible promo exists.
 */
export const resolveBestPromo = async (
  productId: string,
  unit: PriceUnit,
  qty: number
): Promise<IPromotion | null> => {
  const promos = await Promotion.find({ productId, unit, status: 'active' });
  if (promos.length === 0) return null;

  // Base price is needed to compare effective prices. The order flow already
  // requires an active price, so a missing one simply means "no promo applies".
  let basePrice: number;
  try {
    basePrice = (await getActivePrice(productId, unit)).price;
  } catch {
    return null;
  }

  let best: IPromotion | null = null;
  let bestPrice = Infinity;

  for (const promo of promos) {
    if (!isPromoActive(promo)) continue;
    if (promo.minQuantity != null && qty < promo.minQuantity) continue;
    if (promo.maxQuantity != null && qty > promo.maxQuantity) continue;

    const { unitPrice } = applyPromoPrice(basePrice, promo, qty);
    if (unitPrice < bestPrice) {
      bestPrice = unitPrice;
      best = promo;
    }
  }

  return best;
};

// ─── CRUD (admin) ────────────────────────────────────────────────────────────

export const createPromotion = async (input: CreatePromotionInput): Promise<IPromotion> => {
  const product = await Product.findById(input.productId);
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  return Promotion.create({
    name: input.name,
    productId: product._id,
    description: input.description ?? '',
    type: input.type,
    value: input.value,
    getQuantity: input.getQuantity ?? null,
    unit: input.unit,
    minQuantity: input.minQuantity ?? null,
    maxQuantity: input.maxQuantity ?? null,
    stockLimit: input.stockLimit ?? null,
    soldQuantity: 0,
    expiresAt: input.expiresAt ?? null,
    status: input.status ?? 'active'
  });
};

export const listPromotions = async (filters: PromoListFilters = {}): Promise<IPromotion[]> => {
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.productId) query.productId = filters.productId;
  return Promotion.find(query).sort({ createdAt: -1 });
};

/**
 * Returns every promo currently eligible at order creation (status active, not
 * expired, stock still available) — optionally scoped to a product + unit. The
 * frontend mirrors this list to preview pricing; the server re-resolves the
 * best promo atomically at order creation.
 */
export const listActivePromotions = async (filters: ActivePromoFilters = {}): Promise<IPromotion[]> => {
  const query: Record<string, unknown> = { status: 'active' };
  if (filters.productId) query.productId = filters.productId;
  if (filters.unit) query.unit = filters.unit;

  const promos = await Promotion.find(query).sort({ createdAt: -1 });
  return promos.filter(isPromoActive);
};

export const getPromotionById = async (id: string): Promise<IPromotion> => {
  const promo = await Promotion.findById(id);
  if (!promo) {
    throw new AppError('Promotion not found', 404);
  }
  return promo;
};

export const updatePromotion = async (id: string, input: UpdatePromotionInput): Promise<IPromotion> => {
  const promo = await Promotion.findById(id);
  if (!promo) {
    throw new AppError('Promotion not found', 404);
  }

  if (input.productId !== undefined) {
    const product = await Product.findById(input.productId);
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    promo.productId = product._id;
  }
  if (input.name !== undefined) promo.name = input.name;
  if (input.description !== undefined) promo.description = input.description ?? '';
  if (input.type !== undefined) promo.type = input.type;
  if (input.value !== undefined) promo.value = input.value;
  if (input.getQuantity !== undefined) promo.getQuantity = input.getQuantity ?? null;
  if (input.unit !== undefined) promo.unit = input.unit;
  if (input.minQuantity !== undefined) promo.minQuantity = input.minQuantity ?? null;
  if (input.maxQuantity !== undefined) promo.maxQuantity = input.maxQuantity ?? null;
  if (input.stockLimit !== undefined) promo.stockLimit = input.stockLimit ?? null;
  if (input.expiresAt !== undefined) promo.expiresAt = input.expiresAt ?? null;
  if (input.status !== undefined) promo.status = input.status;

  await promo.save();
  return promo;
};

export const setPromotionStatus = async (id: string, status: PromotionStatus): Promise<IPromotion> => {
  const promo = await getPromotionById(id);
  if (promo.status === status) {
    throw new AppError(`Promotion is already ${status}`, 409);
  }
  promo.status = status;
  await promo.save();
  return promo;
};

export const deletePromotion = async (id: string): Promise<void> => {
  await getPromotionById(id);
  await Promotion.deleteOne({ _id: id });
};

// ─── Sold-quantity accounting ────────────────────────────────────────────────

/**
 * Atomically increments soldQuantity with a full-quantity oversell guard: the
 * update only matches when the ENTIRE requested quantity still fits under
 * stockLimit (design D5). This is a single aggregation-pipeline update, so two
 * concurrent orders can never both pass the guard and oversell the promo.
 *
 * - Stock-limited promo with enough remaining quota → `true`.
 * - Stock-limited promo without enough quota → 409 `AppError` naming the promo
 *   and how many units are left.
 * - Unlimited promo (`stockLimit == null`) → plain increment, no cap (true).
 * - Unknown promo id → `false` (nothing was booked).
 */
export const incrementSold = async (promoId: string, qty: number): Promise<boolean> => {
  const result = await Promotion.findOneAndUpdate(
    {
      _id: promoId,
      $expr: {
        $lte: [{ $add: [{ $ifNull: ['$soldQuantity', 0] }, qty] }, '$stockLimit']
      }
    },
    [
      {
        $set: {
          soldQuantity: { $add: [{ $ifNull: ['$soldQuantity', 0] }, qty] }
        }
      }
    ],
    { new: true }
  );

  if (result) {
    return true;
  }

  // No match: the promo is missing, has no limit, or the full quantity does not
  // fit. Re-read it to tell those cases apart and report the remaining quota.
  const promo = await Promotion.findById(promoId);
  if (!promo) {
    return false;
  }

  if (promo.stockLimit == null) {
    // Unlimited promo: plain increment (kept for direct callers).
    await Promotion.updateOne({ _id: promoId }, { $inc: { soldQuantity: qty } });
    return true;
  }

  const remaining = Math.max(0, promo.stockLimit - (promo.soldQuantity ?? 0));
  throw new AppError(
    `La promo "${promo.name}" no tiene stock suficiente: quedan ${remaining} unidades`,
    409
  );
};

/**
 * Decrements soldQuantity (never below 0) when a promo-priced order is
 * cancelled, edited, deleted or partially returned. Uses an aggregation
 * pipeline so the clamp is applied in the same atomic write — a repeated
 * restore can never leave a negative counter.
 */
export const restoreSold = async (promoId: string, qty: number): Promise<void> => {
  await Promotion.updateOne(
    { _id: promoId },
    [
      {
        $set: {
          soldQuantity: {
            $max: [0, { $subtract: [{ $ifNull: ['$soldQuantity', 0] }, qty] }]
          }
        }
      }
    ]
  );
};

// Re-export the promo type for callers building snapshots
export type { PromotionType };