import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cachedGet, cachedList, OfflineCacheMissError } from '../offline-cache.ts';
import { cacheGet, cachePut, openDatabase, type EntityStoreName } from '../offline-db.ts';

const ALL_STORES: readonly EntityStoreName[] = [
  'customers', 'products', 'inventory', 'orders', 'dashboard-summary',
  'purchases', 'suppliers', 'promotions', 'accounts',
];

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

describe('offline-cache', () => {
  const store: EntityStoreName = 'customers';

  beforeEach(async () => {
    setOnline(true);
    const db = await openDatabase();
    for (const name of ALL_STORES) {
      await db.clear(name);
    }
  });

  it('caches successful fetches and serves them when offline', async () => {
    const fetcher = () => Promise.resolve({ name: 'Tienda Los Andes' });

    const fresh = await cachedGet(store, 'c1', fetcher);
    expect(fresh).toEqual({ name: 'Tienda Los Andes' });

    // Value persisted to IndexedDB
    const cached = await cacheGet(store, 'c1');
    expect(cached).toEqual({ name: 'Tienda Los Andes' });

    // Offline → served from cache without touching the network
    setOnline(false);
    const offlineFetcher = vi.fn(() => Promise.reject(new Error('network down')));
    const offline = await cachedGet(store, 'c1', offlineFetcher);
    expect(offline).toEqual({ name: 'Tienda Los Andes' });
    expect(offlineFetcher).not.toHaveBeenCalled();
  });

  it('falls back to the cache on server 5xx errors', async () => {
    await cachePut(store, 'c2', { name: 'Cached client' });

    const result = await cachedGet(store, 'c2', () =>
      Promise.reject({ status: 500, message: 'Server error' })
    );
    expect(result).toEqual({ name: 'Cached client' });
  });

  it('rethrows client errors (4xx) instead of serving the cache', async () => {
    await cachePut(store, 'c3', { name: 'Stale' });

    await expect(
      cachedGet(store, 'c3', () =>
        Promise.reject({ status: 404, message: 'Not found' })
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws OfflineCacheMissError when offline with no cached value', async () => {
    setOnline(false);
    await expect(
      cachedGet(store, 'missing', () => Promise.resolve({}))
    ).rejects.toBeInstanceOf(OfflineCacheMissError);
  });

  it('cachedList stores the list under the fixed key', async () => {
    const list = [{ _id: 'a' }, { _id: 'b' }];
    await cachedList(store, () => Promise.resolve(list));

    const cached = await cacheGet(store, 'all');
    expect(cached).toEqual(list);
  });
});