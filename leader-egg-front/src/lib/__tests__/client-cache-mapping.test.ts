import { describe, it, expect } from 'vitest';
import { resolveGetCache } from '../../api/client.ts';

describe('resolveGetCache — offline-read cache mapping', () => {
  it('caches canonical unfiltered lists under the "all" key', () => {
    expect(resolveGetCache('/v1/orders')).toEqual({ store: 'orders', key: 'all' });
    expect(resolveGetCache('/v1/customers?includeInactive=false')).toEqual({ store: 'customers', key: 'all' });
    expect(resolveGetCache('/v1/products')).toEqual({ store: 'products', key: 'all' });
    expect(resolveGetCache('/v1/inventory')).toEqual({ store: 'inventory', key: 'all' });
    expect(resolveGetCache('/v1/purchases')).toEqual({ store: 'purchases', key: 'all' });
    expect(resolveGetCache('/v1/suppliers?includeInactive=true')).toEqual({ store: 'suppliers', key: 'all' });
    expect(resolveGetCache('/v1/promotions')).toEqual({ store: 'promotions', key: 'all' });
    expect(resolveGetCache('/v1/accounts')).toEqual({ store: 'accounts', key: 'all' });
    expect(resolveGetCache('/v1/dashboard/summary')).toEqual({ store: 'dashboard-summary', key: 'all' });
  });

  it('does NOT cache filtered or search variants of lists', () => {
    expect(resolveGetCache('/v1/orders?status=pending')).toBeNull();
    expect(resolveGetCache('/v1/orders?overdue=true')).toBeNull();
    expect(resolveGetCache('/v1/orders?search=Juan&page=2')).toBeNull();
    expect(resolveGetCache('/v1/customers?search=foo')).toBeNull();
    expect(resolveGetCache('/v1/customers?page=1&limit=10')).toBeNull();
    expect(resolveGetCache('/v1/accounts?onlyDebtors=true')).toBeNull();
  });

  it('does NOT cache sub-paths or reserved segments as entity details', () => {
    expect(resolveGetCache('/v1/orders/today')).toBeNull();
    expect(resolveGetCache('/v1/orders/customers/c1/outstanding')).toBeNull();
    expect(resolveGetCache('/v1/inventory/transactions')).toBeNull();
    expect(resolveGetCache('/v1/products/p1/prices')).toBeNull();
    expect(resolveGetCache('/v1/promotions/active')).toBeNull();
    expect(resolveGetCache('/v1/reports/aging')).toBeNull();
  });

  it('caches single entities by id', () => {
    expect(resolveGetCache('/v1/customers/cust-1')).toEqual({ store: 'customers', key: 'cust-1' });
    expect(resolveGetCache('/v1/products/prod-1')).toEqual({ store: 'products', key: 'prod-1' });
    expect(resolveGetCache('/v1/inventory/prod-1')).toEqual({ store: 'inventory', key: 'prod-1' });
    expect(resolveGetCache('/v1/orders/ord-1')).toEqual({ store: 'orders', key: 'ord-1' });
    expect(resolveGetCache('/v1/purchases/pur-1')).toEqual({ store: 'purchases', key: 'pur-1' });
    expect(resolveGetCache('/v1/suppliers/sup-1')).toEqual({ store: 'suppliers', key: 'sup-1' });
    expect(resolveGetCache('/v1/promotions/promo-1')).toEqual({ store: 'promotions', key: 'promo-1' });
  });

  it('caches the account ledger under a namespaced key', () => {
    expect(resolveGetCache('/v1/accounts/c1/movements')).toEqual({ store: 'accounts', key: 'movements:c1' });
  });
});