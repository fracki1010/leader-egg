import type { Tenant } from '../types/index.ts';

/**
 * Tenant-scoped namespace for the offline layer (IndexedDB + caches).
 *
 * A single browser/device may be used to sign into more than one company
 * (tenant). The offline cache and the offline write queue MUST be scoped per
 * tenant, otherwise tenant B could read tenant A's cached data or — worse —
 * replay tenant A's queued writes using tenant B's token.
 *
 * The namespace is derived from the tenant id persisted by `authStore`
 * (`auth-storage`). When no tenant is present (legacy sessions cached before
 * multi-tenancy, or while logged out) the LEGACY namespace is used, which keeps
 * the historical single-tenant behaviour and physical DB name intact.
 */

/** localStorage key owned by zustand `persist` for the auth store. */
const AUTH_STORAGE_KEY = 'auth-storage';

/** Namespace used when there is no tenant (legacy/pre-multi-tenant cache). */
export const LEGACY_NAMESPACE = 'legacy';

/** Base IndexedDB database name (kept as the legacy name for tenant #1). */
export const OFFLINE_DB_BASE_NAME = 'driver-pwa-db';

/** Stable namespace string for a tenant id (`tenant_<id>`), or the legacy one. */
export function namespaceForTenantId(tenantId: string | null | undefined): string {
  return tenantId ? `tenant_${tenantId}` : LEGACY_NAMESPACE;
}

/**
 * Physical IndexedDB database name for a tenant id.
 *
 * The legacy namespace intentionally maps to the bare base name
 * (`driver-pwa-db`) so a session cached before multi-tenancy keeps resolving its
 * existing data. Every real tenant gets a distinct suffixed database.
 */
export function offlineDbNameForTenantId(tenantId: string | null | undefined): string {
  const namespace = namespaceForTenantId(tenantId);
  return namespace === LEGACY_NAMESPACE
    ? OFFLINE_DB_BASE_NAME
    : `${OFFLINE_DB_BASE_NAME}__${namespace}`;
}

/** Reads the persisted tenant id from `auth-storage`, tolerating absent/garbage data. */
export function readPersistedTenantId(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { tenant?: Tenant | null } };
    const id = parsed.state?.tenant?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * In-memory override of the active tenant.
 * - `undefined` → derive from the persisted auth session
 * - `null` → explicitly no tenant (logged out / legacy)
 */
let activeTenantId: string | null | undefined = undefined;

/** Tenant id currently in effect for the offline namespace. */
export function getActiveTenantId(): string | null {
  return activeTenantId !== undefined ? activeTenantId : readPersistedTenantId();
}

/** Namespace string currently in effect. */
export function getActiveNamespace(): string {
  return namespaceForTenantId(getActiveTenantId());
}

/** IndexedDB database name currently in effect. */
export function getOfflineDbName(): string {
  return offlineDbNameForTenantId(getActiveTenantId());
}

/**
 * Pins the offline namespace to a tenant (on login) or clears it (on logout,
 * passing `null`). Does NOT delete any cached data — the namespace is switched,
 * not emptied, so another tenant's data is never read nor overwritten.
 *
 * Returns the previous tenant id so callers can detect a tenant switch.
 */
export function setActiveTenantId(tenantId: string | null): string | null {
  const previous = getActiveTenantId();
  activeTenantId = tenantId ?? null;
  return previous;
}

/** Test/utility hook: forget the override and re-derive from persisted storage. */
export function resetActiveTenantId(): void {
  activeTenantId = undefined;
}
