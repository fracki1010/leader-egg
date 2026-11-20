import { z } from 'zod';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH = /^\d{4}-\d{2}$/;

/**
 * Anchors a user-picked calendar date at 12:00 UTC of that same day.
 *
 * A date-only string parses to UTC midnight, which is 21:00 of the previous
 * day in ART (UTC-3). Noon UTC is 09:00 ART of the intended day, so every local
 * rendering and every local-day range keeps the day the user picked.
 *
 * A `YYYY-MM` period (used by the reporting endpoints) is anchored to noon of
 * its first day, so local month bucketing resolves to the intended month.
 *
 * Non-date-only values (real instants, numbers, Date objects) pass through
 * untouched, preserving the previous `z.coerce.date()` behaviour.
 */
export const toBusinessDate = (value: unknown): Date | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_ONLY.test(trimmed)) {
      return new Date(`${trimmed}T12:00:00.000Z`);
    }
    if (YEAR_MONTH.test(trimmed)) {
      return new Date(`${trimmed}-01T12:00:00.000Z`);
    }
  }

  if (value instanceof Date) {
    return value;
  }

  return new Date(value as string | number);
};

/**
 * Reusable Zod field for user-entered calendar dates. Compose with
 * `.optional()`, `.nullable()` or `.default()` exactly like the previous
 * `z.coerce.date()` field; the wrapper preserves those outer semantics.
 */
export const businessDateSchema = z.preprocess(toBusinessDate, z.date());
