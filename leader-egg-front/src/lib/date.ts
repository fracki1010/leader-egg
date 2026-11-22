/**
 * Local-calendar date helpers for `<input type="date">` values.
 *
 * `toISOString().split('T')[0]` returns the UTC date, which in ART (UTC-3)
 * is already tomorrow between 21:00 and 23:59 local. These helpers build the
 * `YYYY-MM-DD` key from LOCAL components so the day the user sees is the day
 * that gets sent to the API.
 */

/** Formats a Date as `YYYY-MM-DD` using LOCAL calendar components. */
export const toLocalDate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/** Today's calendar date as `YYYY-MM-DD` in the user's local timezone. */
export const todayLocalDate = (): string => toLocalDate(new Date());

/**
 * Renders a stored date value for a date input.
 *
 * Date-only values arrive as UTC midnight; treating them with UTC components
 * keeps the day that was picked. Real instants (e.g. an end-of-day expiry)
 * use local components. Mirrors the backend `calendarComponents` rule.
 */
export const toDateInputValue = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;

  if (isUtcMidnight) {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${date.getUTCFullYear()}-${month}-${day}`;
  }

  return toLocalDate(date);
};
