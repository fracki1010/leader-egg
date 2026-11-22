import type { PriceUnit } from '../types/index.ts';
import { unitToMaples } from './units.ts';

/**
 * Profit-margin math used by the product detail page.
 *
 * `costPrice` is stored PER MAPLE on the product (may be null when no cost is
 * loaded). The per-unit cost is the maple cost scaled by how many maples the
 * unit holds (medio cajón → maplesPerCajon / 2, cajón → maplesPerCajon).
 */
export interface MarginBreakdown {
  /** Sale price of the unit (maple, medio cajón or cajón). */
  price: number;
  /** Unit cost — costPrice scaled by the unit's maple equivalence. */
  cost: number;
  /** price − cost. */
  margin: number;
  /** (margin / price) × 100; 0 when the price is not positive. */
  marginPct: number;
}

/** Round to 2 decimals — money display. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Round to 1 decimal — margin percentage display. */
export function roundPct(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/**
 * Compute the margin for a single unit.
 *
 * Returns null when the product has no cost loaded (`costPrice == null`).
 * Callers MUST render "sin costo" in that case instead of a fake numeric
 * margin — a missing cost is not a zero margin.
 */
export function computeMargin(
  price: number,
  costPrice: number | null | undefined,
  unit: PriceUnit,
  maplesPerCajon: number,
): MarginBreakdown | null {
  if (costPrice == null) return null;

  // Reuse the shared unit contract: cost per unit = maple cost × unit maples.
  const costPerUnit = costPrice * unitToMaples(1, unit, maplesPerCajon);
  const margin = price - costPerUnit;
  const marginPct = price > 0 ? (margin / price) * 100 : 0;

  return {
    price,
    cost: roundMoney(costPerUnit),
    margin: roundMoney(margin),
    marginPct: roundPct(marginPct),
  };
}

/** Format a margin percentage for display, e.g. 15.9 → "15,9 %". */
export function formatMarginPct(n: number): string {
  return `${n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}
