import { describe, it, expect } from 'vitest';
import { closeDifference } from '../daily-close.ts';

describe('closeDifference (live counted − system cash)', () => {
  it('returns 0 when counted cash matches the system drawer', () => {
    expect(closeDifference(70, 70)).toBe(0);
    expect(closeDifference(0, 0)).toBe(0);
  });

  it('is positive when counted cash exceeds the system drawer (sobre)', () => {
    expect(closeDifference(80, 70)).toBe(10);
  });

  it('is negative when counted cash falls short of the system drawer (faltante)', () => {
    expect(closeDifference(65, 70)).toBe(-5);
  });

  it('rounds to 2 decimal places like the backend', () => {
    // Float noise (0.3 − 0.1 = 0.19999999999999998) is cleaned to 2dp.
    expect(closeDifference(0.3, 0.1)).toBe(0.2);
    expect(closeDifference(0.1, 0.3)).toBe(-0.2);
  });
});