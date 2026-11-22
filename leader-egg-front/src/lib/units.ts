/**
 * Product unit contract — the SINGLE source of truth for selling/stock units
 * and their conversion to maples (the base stock unit).
 *
 * Mirrors `back/src/modules/products/units.ts` so the frontend and backend
 * agree on exactly how quantities and costs convert.
 *
 * Units:
 *  - 'maple'       → 1 maple
 *  - 'medio_cajon' → half a cajón → qty × (maplesPerCajon / 2)
 *  - 'cajon'       → a full cajón → qty × maplesPerCajon
 *
 * `maplesPerCajon` is an integer ≥ 1 (default 12). When it is ODD,
 * `maplesPerCajon / 2` is fractional (e.g. 13 → 6.5). The math stays EXACT — no
 * silent rounding — because stock is tracked in maples and may be fractional.
 */

export type ProductUnit = 'maple' | 'medio_cajon' | 'cajon';

/** Default maples per full cajón when a product does not define its own. */
export const DEFAULT_MAPLES_PER_CAJON = 12;

/**
 * Canonical unit list with their Spanish labels, in display order. Unit
 * selectors render this list so every chooser offers the same three options.
 */
export const PRODUCT_UNIT_OPTIONS = [
  { value: 'maple', label: 'Maple' },
  { value: 'medio_cajon', label: 'Medio cajón' },
  { value: 'cajon', label: 'Cajón' },
] as const;

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
 * Converts a per-unit cost into a per-maple cost. The exact inverse of
 * `unitToMaples(1, unit, maplesPerCajon)`:
 *  - maple       → unitCost
 *  - medio_cajon → unitCost / (maplesPerCajon / 2)
 *  - cajon       → unitCost / maplesPerCajon
 */
export const unitToCostPerMaple = (
  unitCost: number,
  unit: ProductUnit,
  maplesPerCajon: number,
): number => unitCost / unitToMaples(1, unit, maplesPerCajon);

/** Minimal order-line shape needed to render a human-readable summary. */
export interface OrderLineLike {
  quantity: number;
  unit?: ProductUnit;
  productName?: string;
  /** Quantity already converted to maples (present on modern order lines). */
  mapleQty?: number;
}

/**
 * One order line as it should read in a list card: "1 cajón Castaño Grande",
 * "3 maples Blanco Chico". The unit is REAL — never assume maples.
 */
export const orderLineLabel = (item: OrderLineLike): string => {
  const unit = item.unit ?? 'maple';
  const label = unitLabel(unit, { plural: item.quantity !== 1 }).toLowerCase();
  return `${item.quantity} ${label}${item.productName ? ` ${item.productName}` : ''}`;
};

/** "1 maple" / "12 maples" — plural-aware count for summary lines. */
export const maplesCountLabel = (count: number): string =>
  `${count} ${count === 1 ? 'maple' : 'maples'}`;

/**
 * Total maples in an order (used for the card sub-line). Prefers the stored
 * `mapleQty`; legacy lines without it were booked in maples, so `quantity` is
 * already in maples.
 */
export const orderMaplesTotal = (items: OrderLineLike[]): number =>
  items.reduce((acc, item) => acc + (item.mapleQty ?? item.quantity), 0);

/** Spanish label for a unit. Plural form ("Maples", "Medios cajones", "Cajones"). */
export const unitLabel = (unit: ProductUnit, opts?: { plural?: boolean }): string => {
  const plural = opts?.plural ?? false;
  switch (unit) {
    case 'medio_cajon':
      return plural ? 'Medios cajones' : 'Medio cajón';
    case 'cajon':
      return plural ? 'Cajones' : 'Cajón';
    case 'maple':
    default:
      return plural ? 'Maples' : 'Maple';
  }
};
