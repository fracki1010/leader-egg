/**
 * Product unit contract — the SINGLE source of truth for selling/stock units
 * and their conversion to maples (the base stock unit).
 *
 * Units:
 *  - 'maple'       → 1 maple
 *  - 'medio_cajon' → half a cajón → qty × (maplesPerCajon / 2)
 *  - 'cajon'       → a full cajón → qty × maplesPerCajon
 *
 * `maplesPerCajon` is an integer ≥ 1 (default 12). When it is ODD,
 * `maplesPerCajon / 2` is fractional (e.g. 13 → 6.5). The math below stays
 * EXACT — no silent rounding — so callers keep full precision, since stock is
 * tracked in maples and may legitimately be fractional.
 *
 * Data back-compat: existing documents only ever store 'maple' or 'cajon';
 * adding 'medio_cajon' to the enum does not change how those values convert.
 */

export type ProductUnit = 'maple' | 'medio_cajon' | 'cajon';

/** Canonical unit list — reused by every Zod schema and Mongoose enum. */
export const PRODUCT_UNIT_ENUM = ['maple', 'medio_cajon', 'cajon'] as const;

/** Default maples per full cajón when a product does not define its own. */
export const DEFAULT_MAPLES_PER_CAJON = 12;

/**
 * Converts `qty` expressed in `unit` to maples. `maplesPerCajon` is the
 * product's full-cajón size; a medio cajón is exactly half of it.
 */
export const unitToMaples = (qty: number, unit: ProductUnit, maplesPerCajon: number): number => {
  switch (unit) {
    case 'cajon':
      return qty * maplesPerCajon;
    case 'medio_cajon':
      return qty * (maplesPerCajon / 2);
    case 'maple':
    default:
      return qty;
  }
};

/**
 * Converts a per-unit cost into a per-maple cost. The inverse of
 * `unitToMaples(1, unit, maplesPerCajon)`:
 *  - maple       → unitCost
 *  - medio_cajon → unitCost / (maplesPerCajon / 2)
 *  - cajon       → unitCost / maplesPerCajon
 */
export const unitToCostPerMaple = (
  unitCost: number,
  unit: ProductUnit,
  maplesPerCajon: number
): number => unitCost / unitToMaples(1, unit, maplesPerCajon);
