import { describe, it, expect, afterEach, vi } from 'vitest';
import { toLocalDate, todayLocalDate, toDateInputValue } from '../date.ts';

describe('local date helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses LOCAL components, not the UTC date', () => {
    // 23:30 ART on Oct 27 is already Oct 28 in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T23:30:00-03:00'));

    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-28');
    expect(todayLocalDate()).toBe('2026-10-27');
  });

  it('formats any Date with zero-padded local components', () => {
    expect(toLocalDate(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });

  it('renders date-only values (UTC midnight) as the picked day', () => {
    expect(toDateInputValue('2026-10-27T00:00:00.000Z')).toBe('2026-10-27');
  });

  it('renders real instants with local components', () => {
    // End-of-local-day expiry: 23:59:59 ART is the next day in UTC.
    expect(toDateInputValue('2026-10-28T02:59:59.000Z')).toBe('2026-10-27');
  });

  it('returns an empty string for invalid values', () => {
    expect(toDateInputValue('not-a-date')).toBe('');
  });
});
