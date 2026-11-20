/**
 * Local calendar-day helpers.
 *
 * The business reasons about whole local days ("today's cash close"). Input
 * dates can arrive in two shapes:
 *   - a date-only string like '2026-10-03', which JS parses to UTC midnight;
 *   - a real instant like `new Date()`.
 *
 * A date-only string must be interpreted as the calendar date the client meant
 * (UTC components). A real instant must be interpreted on the server's local
 * calendar. `calendarComponents` tells them apart: an instant sitting exactly
 * at UTC midnight is treated as a date-only string, anything else uses local
 * components.
 */

export interface CalendarComponents {
  y: number;
  m: number;
  d: number;
}

const isUtcMidnight = (value: Date): boolean =>
  value.getUTCHours() === 0 &&
  value.getUTCMinutes() === 0 &&
  value.getUTCSeconds() === 0 &&
  value.getUTCMilliseconds() === 0;

export const calendarComponents = (value: Date): CalendarComponents => {
  if (isUtcMidnight(value)) {
    return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
  }
  return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
};

export const startOfCalendarDay = (value: Date): Date => {
  const { y, m, d } = calendarComponents(value);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

export const endOfCalendarDay = (value: Date): Date => {
  const { y, m, d } = calendarComponents(value);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

/** Formats a date as its `YYYY-MM-DD` local calendar key. */
export const toCalendarDateString = (value: Date): string => {
  const { y, m, d } = calendarComponents(value);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
