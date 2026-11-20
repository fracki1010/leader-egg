import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  PRESETS,
  hasPermission,
  isPermission,
  normalizePermissions
} from '../permissions.js';
import { requirePermission } from '../middleware.js';
import { AppError } from '../../../middleware/error-handler.js';

const buildRequest = (role: string, permissions?: string[]): Request =>
  ({
    user: {
      userId: 'user-1',
      role,
      permissions,
      tenantId: 'tenant-1',
      jti: 'jti-1'
    }
  }) as unknown as Request;

const runRequirePermission = (
  permission: string,
  request: Request
): { next: ReturnType<typeof vi.fn>; error: unknown } => {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  requirePermission(permission)(request, {} as Response, next);
  return { next, error: next.mock.calls[0]?.[0] };
};

describe('permission catalog', () => {
  it('builds every module/level combination', () => {
    expect(ALL_PERMISSIONS).toContain('orders.view');
    expect(ALL_PERMISSIONS).toContain('orders.manage');
    expect(ALL_PERMISSIONS).toContain('reports.view');
    expect(ALL_PERMISSIONS).toContain('users.manage');
    expect(ALL_PERMISSIONS).not.toContain('reports.manage');
    expect(isPermission('orders.manage')).toBe(true);
    expect(isPermission('bogus.manage')).toBe(false);
  });

  it('grants admins and superadmins the full set, others nothing', () => {
    expect(DEFAULT_PERMISSIONS_BY_ROLE.admin).toEqual(ALL_PERMISSIONS);
    expect(DEFAULT_PERMISSIONS_BY_ROLE.superadmin).toEqual(ALL_PERMISSIONS);
    expect(DEFAULT_PERMISSIONS_BY_ROLE.driver).toEqual([]);
    expect(DEFAULT_PERMISSIONS_BY_ROLE.viewer).toEqual([]);
    expect(DEFAULT_PERMISSIONS_BY_ROLE.puesto).toEqual([]);
  });

  it('exposes the curated presets', () => {
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
    expect(PRESETS.encargada).not.toContain('config.manage');
    expect(PRESETS.encargada).not.toContain('stock.manage');
    expect(PRESETS.readonly).toContain('orders.view');
    expect(PRESETS.readonly).not.toContain('orders.manage');
  });
});

describe('hasPermission', () => {
  it('lets manage imply view for the same module', () => {
    expect(hasPermission(['orders.manage'], 'orders.view')).toBe(true);
  });

  it('does not let view imply manage', () => {
    expect(hasPermission(['orders.view'], 'orders.manage')).toBe(false);
  });

  it('denies unrelated modules', () => {
    expect(hasPermission(['orders.manage'], 'customers.view')).toBe(false);
  });

  it('ignores unknown permissions', () => {
    expect(hasPermission(['unknown.permission'], 'orders.view')).toBe(false);
  });
});

describe('normalizePermissions', () => {
  it('dedupes, drops unknown values and keeps catalog order', () => {
    const normalized = normalizePermissions([
      'customers.manage',
      'orders.view',
      'orders.view',
      'bogus.value',
      'orders.manage'
    ]);
    expect(normalized).toEqual(['orders.view', 'orders.manage', 'customers.manage']);
  });

  it('returns an empty list for unknown-only input', () => {
    expect(normalizePermissions(['nope', 'also.nope'])).toEqual([]);
  });
});

describe('requirePermission', () => {
  it('bypasses superadmins', () => {
    const { next, error } = runRequirePermission('orders.manage', buildRequest('superadmin'));
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows an admin who has the permission', () => {
    const { error } = runRequirePermission(
      'orders.view',
      buildRequest('admin', ['orders.manage'])
    );
    expect(error).toBeUndefined();
  });

  it('denies an admin who lacks the permission', () => {
    const { error } = runRequirePermission('customers.view', buildRequest('admin', ['orders.view']));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(403);
  });

  it('bypasses non-admin roles (driver on an admin+driver route)', () => {
    const { error } = runRequirePermission('reports.view', buildRequest('driver', []));
    expect(error).toBeUndefined();
  });

  it('returns 401 when there is no authenticated user', () => {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    requirePermission('orders.view')({} as Request, {} as Response, next);
    const error = next.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(401);
  });
});
