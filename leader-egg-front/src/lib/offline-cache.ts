import { cacheGet, cachePut, type EntityStoreName } from './offline-db.ts';
import { isOnline } from './offline-status.ts';

// ─── Config ─────────────────────────────────────────────────────────────────

/** Fixed key under which list responses are cached. */
export const CACHE_LIST_KEY = 'all';

/** How long to wait for the network before falling back to the cache (ms). */
export const FETCH_TIMEOUT_MS = 8000;

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when offline and no cached value exists for the requested entity. */
export class OfflineCacheMissError extends Error {
  constructor(
    message = 'Sin conexión — no hay datos guardados para esta sección'
  ) {
    super(message);
    this.name = 'OfflineCacheMissError';
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isClientError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('La conexión tardó demasiado')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── Read-through cache ─────────────────────────────────────────────────────

/**
 * Read-through cache: network-first when online, IndexedDB fallback when the
 * network fails (offline, timeout, or server 5xx). Successful responses are
 * always written back to the cache. Client errors (4xx) are never served
 * from the cache — they rethrow so the caller sees the real error.
 */
export async function cachedGet<T>(
  storeName: EntityStoreName,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (!isOnline()) {
    const cached = await cacheGet<T>(storeName, key);
    if (cached !== undefined) return cached;
    throw new OfflineCacheMissError();
  }

  try {
    const data = await withTimeout(fetcher(), FETCH_TIMEOUT_MS);
    await cachePut(storeName, key, data);
    return data;
  } catch (err) {
    if (isClientError(err)) throw err;
    const cached = await cacheGet<T>(storeName, key);
    if (cached !== undefined) return cached;
    throw err;
  }
}

/** Read-through cache for list endpoints (stored under the fixed 'all' key). */
export function cachedList<T>(
  storeName: EntityStoreName,
  fetcher: () => Promise<T>,
): Promise<T> {
  return cachedGet<T>(storeName, CACHE_LIST_KEY, fetcher);
}