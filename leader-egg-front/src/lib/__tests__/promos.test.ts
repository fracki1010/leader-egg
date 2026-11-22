import { describe, it, expect } from 'vitest';
import { applyPromoPrice, promoAppliesTo, pickBestPromo, promoTypeLabel, promoShortLabel } from '../promos.ts';
import type { Promotion } from '../../types/index.ts';

const promo = (overrides: Partial<Promotion> = {}): Promotion => ({
  _id: 'p1',
  name: 'Test',
  productId: 'prod1',
  type: 'fixed_price',
  value: 900,
  unit: 'maple',
  minQuantity: null,
  maxQuantity: null,
  stockLimit: null,
  soldQuantity: 0,
  expiresAt: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('applyPromoPrice (frontend mirror)', () => {
  it('fixed_price group pricing: full groups at group price, leftover units at base', () => {
    // base 6000, "3 x $16.000" → value 16000, group size (minQuantity) 3
    const promo = { type: 'fixed_price', value: 16000, minQuantity: 3 } as const;

    expect(applyPromoPrice(6000, promo, 3)).toEqual({ unitPrice: 5333.33, subtotal: 16000 });
    expect(applyPromoPrice(6000, promo, 4)).toEqual({ unitPrice: 5500, subtotal: 22000 });
    expect(applyPromoPrice(6000, promo, 6)).toEqual({ unitPrice: 5333.33, subtotal: 32000 });
    expect(applyPromoPrice(6000, promo, 7)).toEqual({ unitPrice: 5428.57, subtotal: 38000 });
  });

  it('fixed_price below the group size falls back to the base price', () => {
    const promo = { type: 'fixed_price', value: 16000, minQuantity: 3 } as const;
    expect(applyPromoPrice(6000, promo, 2)).toEqual({ unitPrice: 6000, subtotal: 12000 });
  });

  it('fixed_price legacy (minQuantity null) behaves as qty × value', () => {
    expect(applyPromoPrice(1000, { type: 'fixed_price', value: 900 }, 2)).toEqual({
      unitPrice: 900,
      subtotal: 1800,
    });
    expect(applyPromoPrice(6000, { type: 'fixed_price', value: 16000, minQuantity: null }, 4)).toEqual({
      unitPrice: 16000,
      subtotal: 64000,
    });
  });

  it('discount_percent applies the % off', () => {
    expect(applyPromoPrice(100, { type: 'discount_percent', value: 10 }, 5)).toEqual({
      unitPrice: 90,
      subtotal: 450,
    });
  });

  it('buy_x_get_y legacy (getQuantity null): totalPerGroup = value + 1, only paid units charged', () => {
    // value 2 (get 1 free) → group of 3; qty 5 → 1 free, 4 paid × 100 = 400; unit price 80
    expect(applyPromoPrice(100, { type: 'buy_x_get_y', value: 2 }, 5)).toEqual({
      unitPrice: 80,
      subtotal: 400,
    });
  });

  it('buy_x_get_y with getQuantity: pagás 4 llevás 5', () => {
    // value 4, getQuantity 5 → group of 5; qty 5 → 1 free, 4 paid × 100 = 400
    expect(applyPromoPrice(100, { type: 'buy_x_get_y', value: 4, getQuantity: 5 }, 5)).toEqual({
      unitPrice: 80,
      subtotal: 400,
    });
    // qty 10 → 2 free, 8 paid × 100 = 800
    expect(applyPromoPrice(100, { type: 'buy_x_get_y', value: 4, getQuantity: 5 }, 10)).toEqual({
      unitPrice: 80,
      subtotal: 800,
    });
  });

  it('buy_x_get_y 2x1 (value 1, getQuantity 2): pay 1 take 2', () => {
    // qty 2 → 1 free, 1 paid × 100 = 100; unit price 50
    expect(applyPromoPrice(100, { type: 'buy_x_get_y', value: 1, getQuantity: 2 }, 2)).toEqual({
      unitPrice: 50,
      subtotal: 100,
    });
    // qty 5 → 2 free, 3 paid × 100 = 300; unit price 60
    expect(applyPromoPrice(100, { type: 'buy_x_get_y', value: 1, getQuantity: 2 }, 5)).toEqual({
      unitPrice: 60,
      subtotal: 300,
    });
  });

  it('buy_x_get_y legacy at group boundary: value 3 → pay 3 take 4', () => {
    expect(applyPromoPrice(100, { type: 'buy_x_get_y', value: 3 }, 4)).toEqual({
      unitPrice: 75,
      subtotal: 300,
    });
  });
});

describe('promoAppliesTo', () => {
  it('requires active status and matching unit', () => {
    expect(promoAppliesTo(promo(), 'maple', 2)).toBe(true);
    expect(promoAppliesTo(promo({ status: 'inactive' }), 'maple', 2)).toBe(false);
    expect(promoAppliesTo(promo(), 'cajon', 2)).toBe(false);
  });

  it('enforces min/max quantity bounds', () => {
    expect(promoAppliesTo(promo({ minQuantity: 5 }), 'maple', 4)).toBe(false);
    expect(promoAppliesTo(promo({ minQuantity: 5 }), 'maple', 5)).toBe(true);
    expect(promoAppliesTo(promo({ maxQuantity: 10 }), 'maple', 11)).toBe(false);
    expect(promoAppliesTo(promo({ maxQuantity: 10 }), 'maple', 10)).toBe(true);
  });

  it('rejects expired promos (expiresAt in the past)', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(promoAppliesTo(promo({ expiresAt: past }), 'maple', 2)).toBe(false);
  });

  it('accepts promos not yet expired (expiresAt in the future)', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(promoAppliesTo(promo({ expiresAt: future }), 'maple', 2)).toBe(true);
  });

  it('rejects exhausted stock-limited promos', () => {
    expect(promoAppliesTo(promo({ stockLimit: 10, soldQuantity: 10 }), 'maple', 2)).toBe(false);
    expect(promoAppliesTo(promo({ stockLimit: 10, soldQuantity: 5 }), 'maple', 2)).toBe(true);
  });
});

describe('pickBestPromo', () => {
  const fixed = promo({ _id: 'fixed', name: 'Fixed900', type: 'fixed_price', value: 900 });
  const discount = promo({ _id: 'disc', name: 'FiveOff', type: 'discount_percent', value: 5 });

  it('picks the lowest effective unit price', () => {
    const best = pickBestPromo([discount, fixed], 'prod1', 'maple', 2, 1000);
    expect(best?._id).toBe('fixed'); // 900 < 950
  });

  it('returns null when no promo applies', () => {
    expect(pickBestPromo([], 'prod1', 'maple', 2, 1000)).toBeNull();
    expect(pickBestPromo([promo({ productId: 'other' })], 'prod1', 'maple', 2, 1000)).toBeNull();
    expect(pickBestPromo([promo({ status: 'inactive' })], 'prod1', 'maple', 2, 1000)).toBeNull();
    expect(pickBestPromo([promo({ minQuantity: 5 })], 'prod1', 'maple', 2, 1000)).toBeNull();
  });

  it('returns null without a valid base price or quantity', () => {
    expect(pickBestPromo([fixed], 'prod1', 'maple', 2, 0)).toBeNull();
    expect(pickBestPromo([fixed], 'prod1', 'maple', 0, 1000)).toBeNull();
  });
});

describe('promo labels', () => {
  it('maps types to human labels', () => {
    expect(promoTypeLabel('fixed_price')).toBe('Precio fijo');
    expect(promoTypeLabel('discount_percent')).toBe('Descuento %');
    expect(promoTypeLabel('buy_x_get_y')).toContain('Lleva');
  });

  it('builds short chip text', () => {
    expect(promoShortLabel({ type: 'fixed_price', value: 900 })).toBe('$900');
    expect(promoShortLabel({ type: 'fixed_price', value: 16000, minQuantity: 3 })).toBe('3 x $16.000');
    expect(promoShortLabel({ type: 'discount_percent', value: 10 })).toBe('-10%');
    expect(promoShortLabel({ type: 'buy_x_get_y', value: 2 })).toBe('2x1');
    expect(promoShortLabel({ type: 'buy_x_get_y', value: 1, getQuantity: 2 })).toBe('2x1');
    expect(promoShortLabel({ type: 'buy_x_get_y', value: 4, getQuantity: 5 })).toBe('4x5');
  });
});