/**
 * Calendar context injected into every agent system prompt.
 *
 * The model has no clock. Without an explicit ISO date it invents one when the
 * user says "hoy" or "mañana", so the prompt carries today and tomorrow as
 * YYYY-MM-DD in the business timezone (never the UTC day: after 21:00 in
 * Buenos Aires the UTC date is already the next day).
 */

export const AGENT_TIMEZONE = 'America/Argentina/Buenos_Aires';

export interface AgentDateContext {
  timezone: string;
  /** Today's calendar date in the business timezone, YYYY-MM-DD. */
  isoDate: string;
  /** The calendar day after `isoDate`, YYYY-MM-DD. */
  tomorrowIsoDate: string;
  /** Human-readable local date and time, for the prompt only. */
  localDateTime: string;
}

const isoDateIn = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AGENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

const nextDay = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

/** Builds today, tomorrow and the local clock for `now` in the business timezone. */
export const buildDateContext = (now: Date): AgentDateContext => {
  const isoDate = isoDateIn(now);

  const localDateTime = new Intl.DateTimeFormat('es-AR', {
    timeZone: AGENT_TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(now);

  return {
    timezone: AGENT_TIMEZONE,
    isoDate,
    tomorrowIsoDate: nextDay(isoDate),
    localDateTime
  };
};
