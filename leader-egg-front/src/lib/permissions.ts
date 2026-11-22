import type { UserRole } from '../types/index.ts';

/**
 * Per-user, per-module permission catalog.
 *
 * Mirrors the backend catalog (`leader-egg-back/src/modules/auth/permissions.ts`)
 * exactly. A permission is a `<module>.<level>` string (e.g. `orders.manage`).
 * `manage` always implies the matching `view`, and `superadmin` bypasses every
 * check. Driver / puesto / viewer access is role-based, so the frontend only
 * filters modules for `admin`.
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

/** Permission string. Kept as `string` for ergonomic use across the app. */
export type Permission = string;

/** Spanish module labels for the UI. */
export const MODULE_LABELS: Record<PermissionModule, string> = {
  orders: 'Pedidos',
  routes: 'Rutas',
  customers: 'Clientes',
  stock: 'Stock',
  purchases: 'Compras',
  cash: 'Caja',
  accounts: 'Cuentas',
  reports: 'Reportes',
  vehicles: 'Vehículos',
  promotions: 'Promos',
  users: 'Usuarios',
  config: 'Configuración'
};

/** UI display order for the editor (independent from the backend catalog order). */
export const MODULE_DISPLAY_ORDER: PermissionModule[] = [
  'orders',
  'routes',
  'customers',
  'stock',
  'purchases',
  'cash',
  'accounts',
  'reports',
  'vehicles',
  'promotions',
  'users',
  'config'
];

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

/** Every valid permission in deterministic order (module order, then level order). */
export const ALL_PERMISSIONS: string[] = PERMISSION_MODULES.flatMap((module) =>
  MODULE_LEVELS[module].map((level) => `${module}.${level}`)
);

const ALL_PERMISSION_SET = new Set(ALL_PERMISSIONS);

/** Curated shortcuts for the UI. `full` mirrors the admin default. */
export type PresetKey = 'full' | 'cashier' | 'encargada' | 'warehouse' | 'sales' | 'readonly';

export const PRESETS: Record<PresetKey, string[]> = {
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

export const PRESET_LABELS: Record<PresetKey, string> = {
  full: 'Total',
  cashier: 'Cajero',
  encargada: 'Encargada',
  warehouse: 'Depósito',
  sales: 'Ventas',
  readonly: 'Solo lectura'
};

/** Spanish role labels used by the sidebar, settings and account headers. */
export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Super Admin',
  admin: 'Administrador',
  driver: 'Repartidor',
  viewer: 'Repartidor', // legacy label preserved
  puesto: 'Puesto'
};

/** Ordered preset keys for rendering. */
export const PRESET_KEYS: PresetKey[] = ['full', 'cashier', 'encargada', 'warehouse', 'sales', 'readonly'];

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

/** True when both permission lists contain exactly the same permissions. */
export const samePermissions = (a: string[], b: string[]): boolean => {
  const left = normalizePermissions(a);
  const right = normalizePermissions(b);
  return left.length === right.length && left.every((permission, i) => permission === right[i]);
};

/** Minimal user shape accepted by `getHomePath`. */
export interface HomePathUser {
  role: UserRole;
  permissions?: string[];
}

const HOME_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['/orders', 'orders.view'],
  ['/routes', 'routes.view'],
  ['/customers', 'customers.view'],
  ['/products', 'stock.view'],
  ['/compras', 'purchases.view'],
  ['/cuentas', 'accounts.view'],
  ['/cuentas/movimientos', 'cash.view'],
  ['/reports', 'reports.view'],
  ['/vehiculos', 'vehicles.view'],
  ['/promos', 'promotions.view'],
  ['/users', 'users.manage']
];

/**
 * First route the user can actually open.
 *
 * Driver / puesto / viewer land on the dashboard (their access is role-based).
 * Admins need `reports.view` for the dashboard; otherwise the first accessible
 * module wins, and an admin without any permission lands on `/sin-acceso` to
 * avoid an infinite `/dashboard` redirect.
 */
export const getHomePath = (user: HomePathUser | null | undefined): string => {
  if (!user) return '/dashboard';

  if (user.role === 'driver' || user.role === 'puesto' || user.role === 'viewer') {
    return '/dashboard';
  }

  const bypass = user.role === 'superadmin';
  const granted = user.permissions ?? [];
  const can = (permission: string): boolean => bypass || hasPermission(granted, permission);

  if (can('reports.view')) {
    return '/dashboard';
  }

  for (const [path, permission] of HOME_ROUTES) {
    if (can(permission)) {
      return path;
    }
  }

  if (user.role === 'superadmin') {
    return '/setup/punto-cero';
  }

  return '/sin-acceso';
};
