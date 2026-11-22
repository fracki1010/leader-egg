import { describe, it, expect } from 'vitest';
import { computeMargin, formatMarginPct } from '../margin.ts';

describe('computeMargin — profit margin math', () => {
  it('computes the cajón margin from a per-maple cost', () => {
    // Blanco Grande: cost 4416.67/maple × 12 = 53000.04 → margin 9999.96 (≈15.9%)
    const b = computeMargin(63000, 4416.67, 'cajon', 12);
    expect(b).not.toBeNull();
    expect(b!.cost).toBe(53000.04);
    expect(b!.margin).toBe(9999.96);
    expect(b!.marginPct).toBe(15.9);
  });

  it('uses the raw per-maple cost for the maple unit', () => {
    const b = computeMargin(25, 20, 'maple', 12);
    expect(b!.cost).toBe(20);
    expect(b!.margin).toBe(5);
    expect(b!.marginPct).toBe(20);
  });

  it('computes the medio cajón margin from a per-maple cost (half a cajón)', () => {
    // cost 4416.67/maple × (12 / 2) = 26500.02 → margin 32000 − 26500.02 = 5499.98
    const b = computeMargin(32000, 4416.67, 'medio_cajon', 12);
    expect(b).not.toBeNull();
    expect(b!.cost).toBe(26500.02);
    expect(b!.margin).toBe(5499.98);
    expect(b!.marginPct).toBe(17.2);
  });

  it('returns null when the product has no cost loaded', () => {
    expect(computeMargin(63000, null, 'cajon', 12)).toBeNull();
    expect(computeMargin(25, undefined, 'maple', 12)).toBeNull();
  });

  it('reports a negative margin as a loss and 0% for a non-positive price', () => {
    const loss = computeMargin(10, 20, 'maple', 12);
    expect(loss!.margin).toBe(-10);
    expect(loss!.marginPct).toBe(-100);

    const zero = computeMargin(0, 20, 'maple', 12);
    expect(zero!.marginPct).toBe(0);
  });
});

describe('formatMarginPct', () => {
  it('formats to one decimal with the es-AR separator', () => {
    expect(formatMarginPct(15.9)).toBe('15,9 %');
    expect(formatMarginPct(20)).toBe('20,0 %');
  });
});
