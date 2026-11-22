import { cachedGet } from '../lib/offline-cache.ts';
import { CACHE_LIST_KEY } from '../lib/offline-cache.ts';
import type { EntityStoreName } from '../lib/offline-db.ts';
import { enqueue } from '../lib/sync-queue.ts';
import { isOnline } from '../lib/offline-status.ts';
import { getActiveTenantId } from '../lib/offline-namespace.ts';

/** Base URL for every API call. Exported so the platform (multi-tenant) client
 *  can reuse it without duplicating the env lookup. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** Thrown after a write was queued locally while offline (it will sync later). */
export class OfflineWriteQueuedError extends Error {
  constructor(message = 'Guardado sin conexión — se sincronizará') {
    super(message);
    this.name = 'OfflineWriteQueuedError';
  }
}

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem('auth-storage');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed.state?.token ?? null;
  } catch {
    return null;
  }
}

function clearAuth(): void {
  localStorage.removeItem('auth-storage');
}

// ─── Offline-read cache mapping ─────────────────────────────────────────────
// Maps GET endpoints to (entity store, cache key). Lists are cached under the
// fixed 'all' key; single entities under their id. Filtered/search variants are
// NOT cached — only the canonical unfiltered list is.

const LIST_ALLOWED_PARAMS: Record<string, string[]> = {
  customers: ['includeInactive'],
  products: [],
  inventory: [],
  orders: [],
  purchases: [],
  suppliers: ['includeInactive'],
  promotions: [],
  accounts: [],
};

/** Known sub-paths that must not be mistaken for an entity id. */
const RESERVED_ID_SEGMENTS = new Set([
  'today', 'overdue', 'active', 'summary', 'transactions', 'movements',
  'payments', 'receipt', 'returns', 'prices', 'status', 'classify',
  'increment', 'decrement', 'threshold', 'deliver', 'cancel', 'payment',
  'stops', 'optimize', 'start', 'complete', 'advance', 'notes', 'drivers',
  'history', 'frequency', 'top', 'outstanding',
]);

/** Exported for tests — maps a GET endpoint to its cache (store, key) or null. */
export function resolveGetCache(endpoint: string): { store: EntityStoreName; key: string } | null {
  const queryIndex = endpoint.indexOf('?');
  const path = queryIndex === -1 ? endpoint : endpoint.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : endpoint.slice(queryIndex + 1);
  const paramKeys = new Set(new URLSearchParams(query).keys());

  const listAllowed = (store: EntityStoreName): boolean => {
    const allowed = LIST_ALLOWED_PARAMS[store] ?? [];
    return [...paramKeys].every((k) => allowed.includes(k));
  };

  // ── Canonical (unfiltered) lists ──
  switch (path) {
    case '/v1/customers':
      return listAllowed('customers') ? { store: 'customers', key: CACHE_LIST_KEY } : null;
    case '/v1/products':
      return listAllowed('products') ? { store: 'products', key: CACHE_LIST_KEY } : null;
    case '/v1/inventory':
      return listAllowed('inventory') ? { store: 'inventory', key: CACHE_LIST_KEY } : null;
    case '/v1/orders':
      return listAllowed('orders') ? { store: 'orders', key: CACHE_LIST_KEY } : null;
    case '/v1/purchases':
      return listAllowed('purchases') ? { store: 'purchases', key: CACHE_LIST_KEY } : null;
    case '/v1/suppliers':
      return listAllowed('suppliers') ? { store: 'suppliers', key: CACHE_LIST_KEY } : null;
    case '/v1/promotions':
      return listAllowed('promotions') ? { store: 'promotions', key: CACHE_LIST_KEY } : null;
    case '/v1/accounts':
      return listAllowed('accounts') ? { store: 'accounts', key: CACHE_LIST_KEY } : null;
    case '/v1/dashboard/summary':
      return { store: 'dashboard-summary', key: CACHE_LIST_KEY };
  }

  // ── Account ledger for one customer ──
  const movements = /^\/v1\/accounts\/([^/]+)\/movements$/.exec(path);
  if (movements) {
    return { store: 'accounts', key: `movements:${movements[1]}` };
  }

  // ── Single entity by id ──
  const detail = /^\/v1\/(customers|products|inventory|orders|purchases|suppliers|promotions)\/([^/]+)$/.exec(path);
  if (detail && !RESERVED_ID_SEGMENTS.has(detail[2]!)) {
    return { store: detail[1] as EntityStoreName, key: detail[2]! };
  }

  return null;
}

// ─── Offline-write queue allowlist ──────────────────────────────────────────
// Only the most important owner/admin mutations are queued when offline.

function isQueuedWrite(method: string, endpoint: string): boolean {
  const path = endpoint.split('?')[0] ?? endpoint;
  if (method === 'POST' && /^\/v1\/orders$/.test(path)) return true; // createOrder
  if (method === 'POST' && /^\/v1\/orders\/[^/]+\/payments$/.test(path)) return true; // recordPayment
  if (method === 'POST' && /^\/v1\/customers$/.test(path)) return true; // createCustomer
  if (method === 'POST' && /^\/v1\/purchases$/.test(path)) return true; // createPurchase
  if (method === 'PATCH' && /^\/v1\/inventory\/[^/]+$/.test(path)) return true; // adjustStock
  if (method === 'POST' && /^\/v1\/inventory\/[^/]+\/increment$/.test(path)) return true; // incrementStock
  if (method === 'POST' && /^\/v1\/inventory\/[^/]+\/decrement$/.test(path)) return true; // decrementStock
  if (method === 'POST' && /^\/v1\/expenses$/.test(path)) return true; // createExpense
  return false;
}

/**
 * Queue a write for later replay (offline owner/admin mutations).
 * The body is stored as-is (already JSON-stringified by api.post/patch/put).
 *
 * The queue DB is tenant-namespaced and each entry is tagged with the tenant it
 * was queued under, so a write queued in tenant A can never be replayed with
 * tenant B's token.
 */
export async function queueWrite(method: string, url: string, body?: unknown): Promise<string> {
  return enqueue({
    operation: 'apiWrite',
    payload: { method, url, body },
    tenantId: getActiveTenantId(),
    timestamp: Date.now(),
  });
}

// ─── Network layer ──────────────────────────────────────────────────────────

/** Plain network request with auth — no caching, no offline queueing. */
export async function rawRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    const message = typeof data === 'object' && data !== null && 'error' in data
      ? String((data as Record<string, unknown>).error)
      : `Request failed with status ${response.status}`;

    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();

  // GET → read-through entity cache (network-first, IndexedDB fallback)
  if (method === 'GET') {
    const cache = resolveGetCache(endpoint);
    if (cache) {
      return cachedGet<T>(cache.store, cache.key, () => rawRequest<T>(endpoint, options));
    }
    return rawRequest<T>(endpoint, options);
  }

  // Writes → queue when offline (orders, payments, customers, stock, expenses)
  if (!isOnline() && isQueuedWrite(method, endpoint)) {
    await queueWrite(method, endpoint, options.body);
    window.dispatchEvent(
      new CustomEvent('offline:write-queued', { detail: { method, url: endpoint } })
    );
    throw new OfflineWriteQueuedError();
  }

  return rawRequest<T>(endpoint, options);
}

export const api = {
  get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<T>(`${endpoint}${query}`, { method: 'GET' });
  },

  post<T>(endpoint: string, body?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  put<T>(endpoint: string, body?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  delete<T>(endpoint: string): Promise<T> {
    return request<T>(endpoint, { method: 'DELETE' });
  }
};