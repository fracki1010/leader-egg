import { createHash } from 'node:crypto';

/**
 * How far back a previous order/purchase is considered a duplicate.
 * Five minutes covers the real-world retry window observed in production
 * (3 identical purchases 15 s apart, 2 identical orders 29 s apart) without
 * blocking a legitimate repeat sale later in the day.
 */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export const DUPLICATE_MESSAGE_MINUTES = DUPLICATE_WINDOW_MS / 60_000;

/** Minimal shape needed to fingerprint an order/purchase line. */
export interface FingerprintItem {
  productId: string;
  quantity: number;
  unit?: string;
}

/**
 * Stable, price-independent fingerprint for an order/purchase.
 *
 * The items are sorted so the same lines sent in a different order match, and
 * the unit falls back to 'maple' exactly like the creation defaults do. Prices,
 * notes, dates and derived totals are deliberately excluded: retries replay the
 * same payload, so the fingerprint only needs the customer/supplier + lines.
 */
export const buildDuplicateFingerprint = (
  ownerId: string,
  items: ReadonlyArray<FingerprintItem>
): string => {
  const lines = items
    .map((item) => `${item.productId}:${item.quantity}:${item.unit ?? 'maple'}`)
    .sort();
  return createHash('sha1').update(`${ownerId}|${lines.join('|')}`).digest('hex');
};
