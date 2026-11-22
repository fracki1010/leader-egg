import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import {
  addSyncItem,
  getPendingItems,
  openDatabase,
  switchOfflineNamespace,
} from '../offline-db.ts';
import {
  offlineDbNameForTenantId,
  getActiveTenantId,
  getOfflineDbName,
  resetActiveTenantId,
} from '../offline-namespace.ts';

/**
 * Offline layer tenant isolation: the IndexedDB database (and therefore both the
 * read cache and the write queue) must be scoped per tenant, so two companies on
 * the same device never see each other's data.
 */
describe('offline tenant namespacing', () => {
  afterEach(() => {
    switchOfflineNamespace(null);
    localStorage.clear();
    resetActiveTenantId();
  });

  it('resolves two different IndexedDB names for two tenants', () => {
    const dbA = offlineDbNameForTenantId('tenant-a');
    const dbB = offlineDbNameForTenantId('tenant-b');

    expect(dbA).not.toBe(dbB);
    expect(dbA).toMatch(/^driver-pwa-db__/);
    expect(dbA).toContain('tenant-a');
    expect(dbB).toContain('tenant-b');
  });

  it('falls back to the legacy DB name when no tenant is present', () => {
    expect(offlineDbNameForTenantId(null)).toBe('driver-pwa-db');
    expect(offlineDbNameForTenantId(undefined)).toBe('driver-pwa-db');
  });

  it('does not return a queue item saved under another tenant', async () => {
    switchOfflineNamespace('tenant-a');
    const dbA = await openDatabase();
    await dbA.clear('sync-queue');

    await addSyncItem({
      operation: 'apiWrite',
      payload: { method: 'POST', url: '/v1/orders', body: '{"customerId":"c1"}' },
      timestamp: Date.now(),
    });
    expect(await getPendingItems()).toHaveLength(1);

    // Switch company on the same device: tenant A's queue must be invisible.
    switchOfflineNamespace('tenant-b');
    expect(await getPendingItems()).toHaveLength(0);

    // Returning to tenant A restores exactly its own tenant-scoped queue.
    switchOfflineNamespace('tenant-a');
    expect(await getPendingItems()).toHaveLength(1);
  });

  it('resolves the active DB name from the selected tenant', () => {
    switchOfflineNamespace('tenant-x');

    expect(getActiveTenantId()).toBe('tenant-x');
    expect(getOfflineDbName()).toBe(offlineDbNameForTenantId('tenant-x'));
    expect(getOfflineDbName()).not.toBe(offlineDbNameForTenantId(null));
  });
});
