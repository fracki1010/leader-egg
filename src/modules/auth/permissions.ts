import type { UserRole } from './model.js';

/**
 * Per-user, per-module permission catalog.
 *
 * A permission is a `<module>.<level>` string (e.g. `orders.manage`). Admins
 * with the matching permission may use that module; `manage` always implies the
 * corresponding `view`. Role guards still decide WHO reaches a route (admin vs
 * driver/puesto), while these permissions decide WHICH modules an admin can use.
 */

export const PERMISSION_MODULES = [
  'orders',
  'customers',
  'stock',
  'purchases',
  'cash',
  'accounts',
  'routes',
  'vehicles',
  'promotions',
  'reports',
  'users',
  'config'
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export type PermissionLevel = 'view' | 'manage';

/** Levels available on each module. Modules without a natural split expose one. */
export const MODULE_LEVELS: Record<PermissionModule, readonly PermissionLevel[]> = {
  orders: ['view', 'manage'],
  customers: ['view', 'manage'],
  stock: ['view', 'manage'],
  purchases: ['view', 'manage'],
  cash: ['view', 'manage'],
  accounts: ['view', 'manage'],
  routes: ['view', 'manage'],
  vehicles: ['view', 'manage'],
  promotions: ['view', 'manage'],
  reports: ['view'],
  users: ['manage'],
  config: ['manage']
};

/**
 * Every valid permission in deterministic order (module order, then level order).
 */
export const ALL_PERMISSIONS: string[] = PERMISSION_MODULES.flatMap((module) =>
  MODULE_LEVELS[module].map((level) => `${module}.${level}`)
);

/** Permission string. Kept as `string` for ergonomic use in schemas/routes. */
export type Permission = string;

const ALL_PERMISSION_SET = new Set(ALL_PERMISSIONS);

/**
 * Default permissions granted to a role when none are explicitly provided.
 * Superadmins always bypass the permission check, but carrying the full set keeps
 * their persisted state consistent with admins.
 */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<UserRole, string[]> = {
  superadmin: [...ALL_PERMISSIONS],
  admin: [...ALL_PERMISSIONS],
  driver: [],
  viewer: [],
  puesto: []
};

/** Curated shortcuts for the UI. `full` mirrors the admin default. */
export const PRESETS: Record<
  'full' | 'cashier' | 'encargada' | 'warehouse' | 'sales' | 'readonly',
  string[]
> = {
  full: [...ALL_PERMISSIONS],
  cashier: ['orders.manage', 'customers.manage', 'cash.manage', 'accounts.view', 'reports.view'],
  /**
   * Front-desk manager: runs sales, customers and the cash register, and can
   * read stock/purchases/routes/promotions. Cannot touch users, configuration,
   * stock adjustments, purchases, prices, vehicles or promotion editing.
   */
  encargada: [
    'orders.manage',
    'customers.manage',
    'stock.view',
    'purchases.view',
    'cash.manage',
    'accounts.view',
    'routes.view',
    'promotions.view',
    'reports.view'
  ],
  warehouse: ['stock.manage', 'purchases.manage', 'vehicles.manage'],
  sales: ['orders.manage', 'customers.manage', 'routes.manage', 'reports.view'],
  readonly: [
    'orders.view',
    'customers.view',
    'stock.view',
    'purchases.view',
    'cash.view',
    'accounts.view',
    'routes.view',
    'vehicles.view',
    'promotions.view',
    'reports.view'
  ]
};

/** True when `value` is a known `<module>.<level>` permission. */
export const isPermission = (value: string): boolean => ALL_PERMISSION_SET.has(value);

/**
 * True when `granted` satisfies `required`.
 *
 * `manage` on a module implies the module's `view` (e.g. `orders.manage` grants
 * `orders.view`), but not the other way around. Unknown entries never match.
 */
export const hasPermission = (granted: string[], required: string): boolean => {
  if (granted.includes(required)) {
    return true;
  }
  if (required.endsWith('.view')) {
    const module = required.slice(0, -'.view'.length);
    return granted.includes(`${module}.manage`);
  }
  return false;
};

/**
 * Dedupes, drops unknown values and orders the result following ALL_PERMISSIONS.
 * Used before persisting any client-supplied permission list.
 */
export const normalizePermissions = (input: string[]): string[] => {
  const index = new Map(ALL_PERMISSIONS.map((permission, position) => [permission, position]));
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of input) {
    if (!isPermission(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    cleaned.push(value);
  }

  cleaned.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  return cleaned;
};
