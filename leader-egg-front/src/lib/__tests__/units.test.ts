import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAPLES_PER_CAJON,
  PRODUCT_UNIT_OPTIONS,
  unitLabel,
  orderLineLabel,
  orderMaplesTotal,
  maplesCountLabel,
  unitToCostPerMaple,
  unitToMaples,
} from '../units.ts';

describe('unitToMaples', () => {
  it('passes maples through unchanged', () => {
    expect(unitToMaples(5, 'maple', 12)).toBe(5);
    expect(unitToMaples(0, 'maple', 12)).toBe(0);
  });

  it('treats a medio cajón as half a cajón (maplesPerCajon 12 → 6 maples)', () => {
    expect(unitToMaples(1, 'medio_cajon', 12)).toBe(6);
    expect(unitToMaples(3, 'medio_cajon', 12)).toBe(18);
  });

  it('treats a cajón as the full amount', () => {
    expect(unitToMaples(1, 'cajon', 12)).toBe(12);
    expect(unitToMaples(2, 'cajon', 12)).toBe(24);
  });

  it('stays exact when maplesPerCajon is odd', () => {
    expect(unitToMaples(1, 'medio_cajon', 13)).toBe(6.5);
    expect(unitToMaples(2, 'medio_cajon', 13)).toBe(13);
  });
});

describe('unitToCostPerMaple', () => {
  it('is the exact inverse of unitToMaples(1, unit, maplesPerCajon)', () => {
    expect(unitToCostPerMaple(25, 'maple', 12)).toBe(25);
    expect(unitToCostPerMaple(300, 'medio_cajon', 12)).toBe(50);
    expect(unitToCostPerMaple(1200, 'cajon', 12)).toBe(100);
  });
});

describe('unitLabel', () => {
  it('returns the Spanish singular labels', () => {
    expect(unitLabel('maple')).toBe('Maple');
    expect(unitLabel('medio_cajon')).toBe('Medio cajón');
    expect(unitLabel('cajon')).toBe('Cajón');
  });

  it('returns the Spanish plural labels when requested', () => {
    expect(unitLabel('maple', { plural: true })).toBe('Maples');
    expect(unitLabel('medio_cajon', { plural: true })).toBe('Medios cajones');
    expect(unitLabel('cajon', { plural: true })).toBe('Cajones');
  });
});

describe('PRODUCT_UNIT_OPTIONS', () => {
  it('lists the three units in canonical order with their labels', () => {
    expect(PRODUCT_UNIT_OPTIONS.map((o) => o.value)).toEqual(['maple', 'medio_cajon', 'cajon']);
    expect(PRODUCT_UNIT_OPTIONS.map((o) => o.label)).toEqual(['Maple', 'Medio cajón', 'Cajón']);
  });

  it('defaults maplesPerCajon to 12', () => {
    expect(DEFAULT_MAPLES_PER_CAJON).toBe(12);
  });
});


describe('orderLineLabel', () => {
  it('labels a cajón as a cajón — never as a maple', () => {
    expect(orderLineLabel({ quantity: 1, unit: 'cajon', productName: 'Castaño Grande' })).toBe(
      '1 cajón Castaño Grande',
    );
    expect(orderLineLabel({ quantity: 2, unit: 'cajon', productName: 'Blanco Grande' })).toBe(
      '2 cajones Blanco Grande',
    );
  });

  it('labels a medio cajón and legacy maple lines', () => {
    expect(orderLineLabel({ quantity: 1, unit: 'medio_cajon', productName: 'Blanco Chico' })).toBe(
      '1 medio cajón Blanco Chico',
    );
    expect(orderLineLabel({ quantity: 3, productName: 'Blanco Chico' })).toBe(
      '3 maples Blanco Chico',
    );
  });
});

describe('orderMaplesTotal', () => {
  it('uses mapleQty for cajón lines and falls back to quantity for legacy lines', () => {
    expect(
      orderMaplesTotal([
        { quantity: 1, unit: 'cajon', mapleQty: 12 },
        { quantity: 10, unit: 'maple', mapleQty: 10 },
      ]),
    ).toBe(22);
    expect(orderMaplesTotal([{ quantity: 2, unit: 'maple' }])).toBe(2);
  });
});


describe('maplesCountLabel', () => {
  it('pluralizes the maple count', () => {
    expect(maplesCountLabel(0)).toBe('0 maples');
    expect(maplesCountLabel(1)).toBe('1 maple');
    expect(maplesCountLabel(12)).toBe('12 maples');
  });
});
