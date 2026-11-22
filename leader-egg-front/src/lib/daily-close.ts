/**
 * Cierre diario helpers — pure functions shared by the page and its tests.
 */

/** Rounds to 2dp (same convention as the backend `round2`). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Live drawer difference: physically counted cash − system-expected cash.
 * Mirrors the backend formula `difference = countedCash − systemCash`.
 */
export function closeDifference(countedCash: number, systemCash: number): number {
  return round2(countedCash - systemCash);
}