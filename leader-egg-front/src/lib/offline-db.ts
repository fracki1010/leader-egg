import { openDB, type IDBPDatabase } from 'idb';
import type { Route } from '../types/index.ts';
import {
  getActiveTenantId,
  getOfflineDbName,
  setActiveTenantId,
} from './offline-namespace.ts';

const DB_VERSION = 2;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CachedRoute {
  routeId: string;
  data: Route;
  fetchedAt: number;
}

/**
 * A queued operation waiting to be replayed against the network.
 * Discriminated on `operation`:
 * - advanceStop / addNote → driver route actions
 * - apiWrite → generic owner/admin offline write (method + url + body)
 *
 * Every row carries the `tenantId` it was queued under. The queue DB is already
 * namespaced per tenant, but tagging the row lets replay double-check it never
 * sends a queued write from one tenant with another tenant's token.
 */
export type SyncQueueItem =
  | {
      id: string;
      operation: 'advanceStop' | 'addNote';
      payload: {
        routeId: string;
        stopId: string;
        status?: string;
        notes?: string;
      };
      /** Tenant the write belongs to (null = legacy/default namespace). */
      tenantId?: string | null;
      timestamp: number;
      synced: boolean;
      conflict: boolean;
      error?: string;
    }
  | {
      id: string;
      operation: 'apiWrite';
      payload: {
        method: string;
        url: string;
        body?: unknown;
      };
      /** Tenant the write belongs to (null = legacy/default namespace). */
      tenantId?: string | null;
      timestamp: number;
      synced: boolean;
      conflict: boolean;
      error?: string;
    };

/**
 * Generic entity stores for the offline-read cache (owner/admin views).
 * Each store holds EntityRecord rows keyed by `key` (entity id or 'all' for lists).
 */
export type EntityStoreName =
  | 'customers'
  | 'products'
  | 'inventory'
  | 'orders'
  | 'dashboard-summary'
  | 'purchases'
  | 'suppliers'
  | 'promotions'
  | 'accounts';

export const ENTITY_STORES: readonly EntityStoreName[] = [
  'customers',
  'products',
  'inventory',
  'orders',
  'dashboard-summary',
  'purchases',
  'suppliers',
  'promotions',
  'accounts',
];

/** Generic record shape stored in every entity store. */
export interface EntityRecord<T = unknown> {
  key: string;
  value: T;
  cachedAt: number;
}

interface DriverPwaDB {
  routes: {
    key: string;
    value: CachedRoute;
    indexes: { 'by-fetchedAt': number };
  };
  'sync-queue': {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-synced': number };
  };
  customers: { key: string; value: EntityRecord };
  products: { key: string; value: EntityRecord };
  inventory: { key: string; value: EntityRecord };
  orders: { key: string; value: EntityRecord };
  'dashboard-summary': { key: string; value: EntityRecord };
  purchases: { key: string; value: EntityRecord };
  suppliers: { key: string; value: EntityRecord };
  promotions: { key: string; value: EntityRecord };
  accounts: { key: string; value: EntityRecord };
}

// ─── Database singleton ─────────────────────────────────────────────────────
// The DB name is tenant-scoped, so the singleton is tracked alongside the name
// it was opened for. When the active tenant changes, the next openDatabase()
// transparently opens the new namespace's database.

let dbPromise: Promise<IDBPDatabase<DriverPwaDB>> | null = null;
let dbPromiseName: string | null = null;

/** IndexedDB database name for the active tenant (exported for tests/ops). */
export function getDatabaseName(): string {
  return getOfflineDbName();
}

export function openDatabase(): Promise<IDBPDatabase<DriverPwaDB>> {
  const name = getOfflineDbName();
  if (!dbPromise || dbPromiseName !== name) {
    dbPromiseName = name;
    dbPromise = openDB<DriverPwaDB>(name, DB_VERSION, {
      upgrade(db) {
        // Routes store
        if (!db.objectStoreNames.contains('routes')) {
          const routeStore = db.createObjectStore('routes', { keyPath: 'routeId' });
          routeStore.createIndex('by-fetchedAt', 'fetchedAt');
        }

        // Sync queue store
        if (!db.objectStoreNames.contains('sync-queue')) {
          const syncStore = db.createObjectStore('sync-queue', { keyPath: 'id' });
          syncStore.createIndex('by-synced', 'synced');
        }

        // Generic entity stores (v2) — created on fresh install and on v1→v2 migration
        for (const storeName of ENTITY_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'key' });
          }
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Drops the cached connection so the next {@link openDatabase} call re-opens the
 * current namespace (used when the active tenant changes). Pending caches in the
 * old database are NOT deleted — they stay scoped to their own tenant.
 */
export function resetOfflineDatabase(): void {
  const pending = dbPromise;
  dbPromise = null;
  dbPromiseName = null;
  if (pending) {
    void pending.then((db) => db.close()).catch(() => undefined);
  }
}

/**
 * Points the offline layer at a tenant's namespace (or the legacy one when
 * `tenantId` is null) and resets the open connection if the namespace changed.
 * Cached data is never deleted — only the active namespace is switched.
 */
export function switchOfflineNamespace(tenantId: string | null): void {
  const previous = getActiveTenantId();
  if ((previous ?? null) === (tenantId ?? null)) return;
  setActiveTenantId(tenantId);
  resetOfflineDatabase();
}

// ─── Routes CRUD ────────────────────────────────────────────────────────────

export async function saveRoute(route: Route): Promise<void> {
  const db = await openDatabase();
  await db.put('routes', {
    routeId: route._id,
    data: route,
    fetchedAt: Date.now(),
  });
}

export async function getRoute(routeId: string): Promise<CachedRoute | undefined> {
  const db = await openDatabase();
  return db.get('routes', routeId);
}

export async function clearRoutes(): Promise<void> {
  const db = await openDatabase();
  await db.clear('routes');
}

// ─── Generic entity cache CRUD ──────────────────────────────────────────────

export async function cachePut<T>(storeName: EntityStoreName, key: string, value: T): Promise<void> {
  const db = await openDatabase();
  const record: EntityRecord<T> = { key, value, cachedAt: Date.now() };
  await db.put(storeName, record);
}

export async function cacheGet<T>(storeName: EntityStoreName, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  const record = await db.get(storeName, key);
  return record?.value as T | undefined;
}

export async function cacheGetAll<T>(storeName: EntityStoreName): Promise<EntityRecord<T>[]> {
  const db = await openDatabase();
  return (await db.getAll(storeName)) as EntityRecord<T>[];
}

export async function cacheDelete(storeName: EntityStoreName, key: string): Promise<void> {
  const db = await openDatabase();
  await db.delete(storeName, key);
}

export async function cacheClear(storeName: EntityStoreName): Promise<void> {
  const db = await openDatabase();
  await db.clear(storeName);
}

// ─── Sync Queue CRUD ────────────────────────────────────────────────────────

export async function addSyncItem(
  item: Omit<SyncQueueItem, 'id' | 'synced' | 'conflict'>
): Promise<string> {
  const db = await openDatabase();
  const id = crypto.randomUUID();
  // Tag the row with the tenant it was queued under (falls back to the active
  // namespace). This lets replay refuse to send it with another tenant's token.
  const tenantId = item.tenantId ?? getActiveTenantId();
  // Spread of the discriminated union is widened; re-assert to the exact variant.
  const record = { ...item, tenantId, id, synced: false, conflict: false } as SyncQueueItem;
  await db.put('sync-queue', record);
  return id;
}

export async function getPendingItems(): Promise<SyncQueueItem[]> {
  const db = await openDatabase();
  const all = await db.getAll('sync-queue');
  // IndexedDB returns records in key order (random UUIDs), so sort by timestamp
  // to guarantee FIFO replay order.
  return all
    .filter((item) => !item.synced)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function markSynced(id: string): Promise<void> {
  const db = await openDatabase();
  const item = await db.get('sync-queue', id);
  if (item) {
    item.synced = true;
    await db.put('sync-queue', item);
  }
}

export async function markConflict(id: string, error: string): Promise<void> {
  const db = await openDatabase();
  const item = await db.get('sync-queue', id);
  if (item) {
    item.conflict = true;
    item.error = error;
    await db.put('sync-queue', item);
  }
}