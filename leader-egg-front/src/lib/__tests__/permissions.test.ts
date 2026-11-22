import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSIONS,
  PRESETS,
  getHomePath,
  hasPermission,
  isPermission,
  normalizePermissions,
} from '../permissions.ts';

describe('permissions catalog', () => {
  it('treats manage as implying view', () => {
    expect(hasPermission(['orders.manage'], 'orders.view')).toBe(true);
    expect(hasPermission(['orders.view'], 'orders.manage')).toBe(false);
  });

  it('denies unrelated modules', () => {
    expect(hasPermission(['orders.manage'], 'customers.view')).toBe(false);
  });

  it('ignores unknown permissions', () => {
    expect(isPermission('orders.view')).toBe(true);
    expect(isPermission('nope.manage')).toBe(false);
    expect(hasPermission(['nope.view'], 'orders.view')).toBe(false);
    expect(hasPermission(['orders.view'], 'nope.view')).toBe(false);
  });

  it('matches the backend preset sets', () => {
    expect(PRESETS.full).toEqual(ALL_PERMISSIONS);
    expect(PRESETS.cashier).toContain('cash.manage');
    expect(PRESETS.encargada).toEqual([
      'orders.manage',
      'customers.manage',
      'stock.view',
      'purchases.view',
      'cash.manage',
      'accounts.view',
      'routes.view',
      'promotions.view',
      'reports.view'
    ]);
    expect(PRESETS.encargada).not.toContain('users.manage');
    expect(PRESETS.warehouse).toEqual(['stock.manage', 'purchases.manage', 'vehicles.manage']);
    expect(PRESETS.readonly).toContain('orders.view');
    expect(PRESETS.readonly).not.toContain('orders.manage');
  });

  it('normalizes by dropping unknown/duplicate values and ordering by the catalog', () => {
    expect(
      normalizePermissions(['customers.view', 'bogus', 'orders.manage', 'orders.view', 'orders.view']),
    ).toEqual(['orders.view', 'orders.manage', 'customers.view']);
  });
});

describe('getHomePath', () => {
  it('sends an admin with reports.view to the dashboard', () => {
    expect(getHomePath({ role: 'admin', permissions: ['reports.view'] })).toBe('/dashboard');
  });

  it('sends an admin without reports.view to the first allowed module', () => {
    expect(getHomePath({ role: 'admin', permissions: ['orders.view'] })).toBe('/orders');
    expect(getHomePath({ role: 'admin', permissions: ['customers.view'] })).toBe('/customers');
  });

  it('sends an admin with no permissions to the sin-acceso page', () => {
    expect(getHomePath({ role: 'admin', permissions: [] })).toBe('/sin-acceso');
  });

  it('keeps non-admin roles on the dashboard', () => {
    expect(getHomePath({ role: 'driver', permissions: [] })).toBe('/dashboard');
    expect(getHomePath({ role: 'puesto' })).toBe('/dashboard');
    expect(getHomePath({ role: 'viewer' })).toBe('/dashboard');
  });
});
