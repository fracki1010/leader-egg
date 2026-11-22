import type { PriceUnit, Promotion } from '../types/index.ts';

/**
 * Frontend mirror of the backend promo pricing (design D6 — display only).
 * The server re-resolves and prices the order atomically at creation; this
 * copy exists so NewOrderPage can preview the discounted unit price live as
 * quantity/unit change.
 */

export interface PromoPricing {
  /** Effective per-unit price for the whole line. */
  unitPrice: number;
  /** Line subtotal — buy_x_get_y charges only the paid units. */
  subtotal: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Mirrors back/src/modules/promotions/service.ts applyPromoPrice. */
export function applyPromoPrice(
  basePrice: number,
  promo: Pick<Promotion, 'type' | 'value' | 'getQuantity' | 'minQuantity'>,
  qty: number
): PromoPricing {
  switch (promo.type) {
    case 'fixed_price': {
      // Group pricing (mirror of the backend): `value` is the price of a group
      // of `minQuantity` units (default 1). Full groups pay the group price;
      // leftover units pay the base price. unitPrice is the effective average.
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
}

/** A promo is eligible for a line when active (status + not expired + stock available) AND qty within min/max. */
export function promoAppliesTo(
  promo: Promotion,
  unit: PriceUnit,
  qty: number
): boolean {
  if (promo.status !== 'active') return false;
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= Date.now()) return false;
  if (promo.stockLimit != null && promo.soldQuantity >= promo.stockLimit) return false;
  if (promo.unit !== unit) return false;
  if (promo.minQuantity != null && qty < promo.minQuantity) return false;
  if (promo.maxQuantity != null && qty > promo.maxQuantity) return false;
  return true;
}

/**
 * Picks the most favorable (lowest effective unit price) promo for a
 * product + unit + quantity from the active list. Returns null when none
 * applies. Mirrors back/src resolveBestPromo (which also skips date-expired
 * and stock-exhausted promos — those are already filtered out of the active
 * list by the server).
 */
export function pickBestPromo(
  promos: Promotion[],
  productId: string,
  unit: PriceUnit,
  qty: number,
  basePrice: number
): Promotion | null {
  if (!Number.isFinite(basePrice) || basePrice <= 0 || qty <= 0) return null;

  let best: Promotion | null = null;
  let bestPrice = Infinity;

  for (const promo of promos) {
    if (promo.productId !== productId) continue;
    if (!promoAppliesTo(promo, unit, qty)) continue;
    const { unitPrice } = applyPromoPrice(basePrice, promo, qty);
    if (unitPrice < bestPrice) {
      bestPrice = unitPrice;
      best = promo;
    }
  }

  return best;
}

/** Human label for the promo type — used in the PROMO chip. */
export function promoTypeLabel(type: Promotion['type']): string {
  switch (type) {
    case 'fixed_price':
      return 'Precio fijo';
    case 'discount_percent':
      return 'Descuento %';
    case 'buy_x_get_y':
      return 'Lleva X, paga menos';
  }
}

/** Short chip text, e.g. "PROMO -10%" / "PROMO 3 x $16.000" / "PROMO 2x1" / "PROMO 4x5". */
export function promoShortLabel(
  promo: Pick<Promotion, 'type' | 'value' | 'getQuantity' | 'minQuantity'>
): string {
  switch (promo.type) {
    case 'fixed_price': {
      const money = `$${promo.value.toLocaleString('es-AR')}`;
      // Group pricing: read as "N x $P" whenever the promo buys in groups of N > 1.
      return promo.minQuantity != null && promo.minQuantity > 1
        ? `${promo.minQuantity} x ${money}`
        : money;
    }
    case 'discount_percent':
      return `-${promo.value}%`;
    case 'buy_x_get_y': {
      if (promo.getQuantity == null) return `${promo.value}x1`;
      // Classic "2x1" (pagás 1 llevás 2) keeps the canonical "llevás x pagás"
      // order; other deals read as "pagás {value} llevás {getQuantity}".
      return promo.value === 1 ? `${promo.getQuantity}x${promo.value}` : `${promo.value}x${promo.getQuantity}`;
    }
  }
}