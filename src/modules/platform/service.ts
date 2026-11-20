import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { randomUUID } from 'node:crypto';
import { Types, type Connection } from 'mongoose';
import { AppError } from '../../middleware/error-handler.js';
import { env } from '../../config/env.js';
import {
  EmailIndex,
  PlatformAdmin,
  Tenant,
  type IPlatformAdmin,
  type ITenant
} from '../../tenancy/master-models.js';
import {
  deprovisionTenant,
  getTenantById,
  provisionTenant,
  refreshTenantCache
} from '../../tenancy/tenants.js';
import { getTenantConnection } from '../../tenancy/registry.js';
import { runWithTenancy } from '../../tenancy/context.js';
import { platformDbName } from '../../tenancy/master.js';
import { User, type IUser, type UserRole } from '../auth/model.js';
import { DEFAULT_PERMISSIONS_BY_ROLE, normalizePermissions } from '../auth/permissions.js';
import { getBlacklist } from '../auth/blacklist.js';
import { getOrCreateConfig, setPuntoCero } from '../config/service.js';
import { Product, displayName } from '../products/model.js';
import { Customer } from '../customers/model.js';
import { Supplier } from '../suppliers/model.js';
import { Inventory } from '../inventory/model.js';
import type {
  ChangePasswordInput,
  CreatePlatformUserInput,
  CreateTenantInput,
  PlatformLoginInput,
  PlatformSetPuntoCeroInput,
  PlatformTenantResetInput,
  ResetPlatformUserPasswordInput,
  UpdatePlatformUserInput,
  UpdateTenantInput
} from './schema.js';

/**
 * Platform (super-tenant) module.
 *
 * Everything here is model-agnostic master data: it reads and writes the
 * platform database only (Tenant / EmailIndex / PlatformAdmin) and, where a
 * tenant user count is needed, opens the tenant connection EXPLICITLY through
 * `runWithTenancy` — platform requests never leak into a tenant's ALS scope.
 */

export interface PlatformTokenPayload {
  adminId: string;
  scope: 'platform';
  jti: string;
}

/**
 * Secret used to sign/verify platform tokens.
 *
 * Prefers the dedicated `PLATFORM_JWT_SECRET`; when unset it derives
 * `${JWT_SECRET}__platform`. This keeps a leaked tenant secret from minting
 * platform tokens. Changing the effective value invalidates existing platform
 * sessions (users must re-login) — acceptable pre-deploy.
 */
export const getPlatformJwtSecret = (): string =>
  env.PLATFORM_JWT_SECRET ?? `${env.JWT_SECRET}__platform`;

/** Audience claim discriminating platform tokens from tenant tokens. */
const PLATFORM_TOKEN_AUDIENCE = 'platform';

export interface PlatformTenantView {
  id: string;
  name: string;
  slug: string;
  dbName: string;
  active: boolean;
  plan?: string;
  createdAt: Date;
  /** Number of users in the tenant DB, or `null` when the DB is unreachable. */
  userCount: number | null;
}

const signPlatformToken = (admin: IPlatformAdmin): string => {
  const jti = randomUUID();
  return jwt.sign(
    { adminId: admin._id.toString(), scope: 'platform', jti },
    getPlatformJwtSecret(),
    {
      audience: PLATFORM_TOKEN_AUDIENCE,
      expiresIn: env.JWT_EXPIRES_IN as StringValue
    }
  );
};

/**
 * Authenticates a platform admin against the `PlatformAdmin` collection.
 * Unknown email and wrong password are indistinguishable (generic 401).
 */
export const platformLogin = async (
  input: PlatformLoginInput
): Promise<{ token: string; admin: IPlatformAdmin }> => {
  const email = input.email.trim().toLowerCase();
  const admin = await PlatformAdmin.findOne({ email });
  const isValid = admin ? await bcrypt.compare(input.password, admin.passwordHash) : false;

  if (!admin || !isValid) {
    // Log the failure without leaking whether the account exists.
    console.warn(`Platform login failed for ${email}`);
    throw new AppError('Invalid credentials', 401);
  }

  return { token: signPlatformToken(admin), admin };
};

/**
 * Loads the authenticated platform admin by id. Shared by `GET /me` and the
 * password change so both fail closed (401) if the admin no longer exists.
 */
export const getPlatformAdmin = async (adminId: string): Promise<IPlatformAdmin> => {
  if (!Types.ObjectId.isValid(adminId)) {
    throw new AppError('Invalid platform token', 401);
  }
  const admin = await PlatformAdmin.findById(adminId);
  if (!admin) {
    throw new AppError('Platform admin no longer exists', 401);
  }
  return admin;
};

/**
 * Changes the authenticated platform admin's password.
 *
 * Verifies the current password with bcrypt before writing. A wrong current
 * password fails with a generic 400 and leaves the stored hash untouched.
 * Existing tokens are NOT revoked here — the call succeeds and the caller may
 * keep using the current session.
 */
export const changePlatformPassword = async (
  adminId: string,
  input: ChangePasswordInput
): Promise<void> => {
  const admin = await getPlatformAdmin(adminId);

  const isValid = await bcrypt.compare(input.currentPassword, admin.passwordHash);
  if (!isValid) {
    throw new AppError('La contraseña actual es incorrecta', 400);
  }

  admin.passwordHash = await bcrypt.hash(input.newPassword, 10);
  await admin.save();
};

/**
 * Validates a platform JWT: signature, `audience === 'platform'`,
 * `scope === 'platform'`, blacklist, and that the bound `PlatformAdmin` still
 * exists (a deleted admin's token is rejected with 401). A tenant token
 * (signed for the `tenant` audience) is rejected with 401.
 */
export const validatePlatformToken = async (token: string): Promise<PlatformTokenPayload> => {
  let decoded: PlatformTokenPayload;
  try {
    decoded = jwt.verify(token, getPlatformJwtSecret(), {
      audience: PLATFORM_TOKEN_AUDIENCE
    }) as PlatformTokenPayload;
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  if (decoded.scope !== 'platform' || !decoded.adminId) {
    throw new AppError('Invalid platform token', 401);
  }

  if (await getBlacklist().has(decoded.jti)) {
    throw new AppError('Token has been revoked', 401);
  }

  // Bind the token to an existing admin (deleted admin → 401). One lookup per
  // request — no cross-request cache, so a deleted admin fails immediately.
  if (!Types.ObjectId.isValid(decoded.adminId)) {
    throw new AppError('Invalid platform token', 401);
  }
  const admin = await PlatformAdmin.findById(decoded.adminId).select('_id');
  if (!admin) {
    throw new AppError('Platform admin no longer exists', 401);
  }

  return decoded;
};

/** Best-effort per-tenant user count; `null` when the tenant DB is unreachable. */
const countTenantUsers = async (tenant: ITenant): Promise<number | null> => {
  try {
    const connection = getTenantConnection(tenant.dbName);
    return await runWithTenancy({ connection, tenantId: String(tenant._id) }, () =>
      User.countDocuments()
    );
  } catch {
    return null;
  }
};

const toTenantView = async (tenant: ITenant): Promise<PlatformTenantView> => ({
  id: String(tenant._id),
  name: tenant.name,
  slug: tenant.slug,
  dbName: tenant.dbName,
  active: tenant.active,
  plan: tenant.plan ?? undefined,
  createdAt: tenant.createdAt,
  userCount: await countTenantUsers(tenant)
});

/** Lists every tenant with a best-effort user count from each tenant DB. */
export const listTenants = async (): Promise<PlatformTenantView[]> => {
  const tenants = await Tenant.find().sort({ createdAt: 1 });
  return Promise.all(tenants.map((tenant) => toTenantView(tenant)));
};

/** Provisions a new tenant + seeds its database + indexes its admin email. */
export const createTenant = async (input: CreateTenantInput): Promise<ITenant> =>
  provisionTenant(input);

/**
 * Updates a tenant. `name` renames; `active` suspends/activates. `dbName` and
 * `slug` are immutable and cannot be changed here.
 */
export const updateTenant = async (
  id: string,
  input: UpdateTenantInput
): Promise<ITenant> => {
  const tenant = await getTenantById(id);
  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }

  let dirty = false;
  if (input.name !== undefined) {
    tenant.name = input.name.trim();
    dirty = true;
  }
  if (input.active !== undefined) {
    tenant.active = input.active;
    dirty = true;
  }

  if (dirty) {
    await tenant.save();
    await refreshTenantCache();
  }

  return tenant;
};

/**
 * Deprovisions a tenant: drops its database and removes its platform rows.
 * Requires `confirm` to match the tenant slug (400 otherwise). The platform DB
 * is always refused; the primary tenant requires `allowPrimary: true`.
 */
export const deleteTenant = async (
  id: string,
  confirm: string,
  allowPrimary = false
): Promise<void> => deprovisionTenant(id, { confirm, allowPrimary });

// ── Tenant data reset ────────────────────────────────────────────────────────
//
// Reproduces the semantics of `src/scripts/reset-all.ts` over HTTP, scoped to a
// single tenant database. Documents are deleted with `deleteMany({})` (never
// `dropCollection`) so indexes and collection options survive; append-only
// Mongoose hooks are bypassed by using the raw driver on the tenant connection.
//
// Reference data is kept (customers, users, products, price entries), stock is
// zeroed in place (inventory docs must remain or `adjustStock` would 404), and
// the singleton business config is reset instead of deleted.

/** Business collections whose documents are removed by a reset. */
const RESET_DELETED_COLLECTIONS = [
  'orders',
  'payments',
  'purchases',
  'expenses',
  'returns',
  'routes',
  'vehicles',
  'suppliers',
  'promotions',
  'cashadjustments',
  'customercharges',
  'customerpayments',
  'dailycloses',
  'stocktransactions',
  'counters'
] as const;

/** Reference/identity collections that always survive a reset untouched. */
const RESET_KEPT_COLLECTIONS = ['customers', 'users', 'products', 'priceentries'] as const;

/** Result of `POST /v1/platform/tenants/:id/reset`. */
export interface PlatformTenantResetResult {
  tenant: { id: string; name: string; slug: string };
  /** Collection name → deleted document count (only existing collections). */
  deleted: Record<string, number>;
  /** Collection name → remaining document count (only existing collections). */
  kept: Record<string, number>;
  /** Inventory documents whose quantity was set to 0. */
  inventoryZeroed: number;
  customerDebtsZeroed: boolean;
  /** True only when an existing business-config doc was reset (never created). */
  configReset: boolean;
}

/** MongoDB "namespace not found" (collection dropped concurrently). */
const isNamespaceError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: number }).code;
  const message = (error as { message?: string }).message ?? '';
  return code === 26 || /ns not found|namespace.*not found/i.test(message);
};

/**
 * `POST /v1/platform/tenants/:id/reset` — clears ONE tenant's business data.
 *
 * Requires `confirm === tenant.slug` and refuses the platform database. The
 * primary tenant DB (`leader_egg`, tenant #1) IS allowed: resetting it is the
 * main use case. Idempotent: a second run reports zero deletions.
 *
 * All reads/writes run inside the tenant's ALS scope. Nothing sensitive is
 * logged or returned — only per-collection counts.
 */
export const resetPlatformTenant = async (
  tenantId: string,
  input: PlatformTenantResetInput
): Promise<PlatformTenantResetResult> => {
  const tenant = await resolveTenantById(tenantId);

  if (tenant.dbName === platformDbName) {
    throw new AppError('Cannot reset the platform database', 400);
  }

  if (input.confirm !== tenant.slug) {
    throw new AppError('Confirmation slug does not match the tenant slug', 400);
  }

  const connection = getTenantConnection(tenant.dbName);

  const summary = await runWithTenancy(
    { connection, tenantId: String(tenant._id) },
    async () => {
      const db = connection.db;
      if (!db) {
        throw new AppError('No tenant database connection', 500);
      }

      // Drive every count from the collections that actually exist so the
      // response never claims to have touched an absent collection.
      const existing = new Set(
        (await db.listCollections({}, { nameOnly: true }).toArray())
          .map((collection) => collection.name)
          .filter((name) => !name.startsWith('system.'))
      );

      const deleted: Record<string, number> = {};
      for (const name of RESET_DELETED_COLLECTIONS) {
        if (!existing.has(name)) continue;
        try {
          const result = await db.collection(name).deleteMany({});
          deleted[name] = result.deletedCount ?? 0;
        } catch (error) {
          if (!isNamespaceError(error)) throw error;
          deleted[name] = 0;
        }
      }

      const kept: Record<string, number> = {};
      for (const name of RESET_KEPT_COLLECTIONS) {
        if (!existing.has(name)) continue;
        kept[name] = await db.collection(name).countDocuments();
      }

      let inventoryZeroed = 0;
      if (existing.has('inventories')) {
        const result = await db
          .collection('inventories')
          .updateMany({}, { $set: { quantity: 0, lastUpdated: new Date() } });
        inventoryZeroed = result.modifiedCount;
      }

      let configReset = false;
      if (existing.has('businessconfigs')) {
        const result = await db.collection('businessconfigs').updateMany(
          {},
          {
            $set: {
              openingCash: 0,
              openingBalances: { cash: 0, mp: 0, bank: 0 },
              // Clear every one-time lock so the tenant can load balances again.
              openingBalancesSetAt: { cash: null, mp: null, bank: null },
              puntoCeroFinalized: false,
              puntoCeroFinalizedAt: null
            }
          }
        );
        // Missing singleton doc → report false; never create one here.
        configReset = result.matchedCount > 0;
      }

      let customerDebtsZeroed = false;
      if (input.zeroCustomerDebt === true && existing.has('customers')) {
        await db.collection('customers').updateMany({}, { $set: { openingDebt: 0 } });
        customerDebtsZeroed = true;
      }

      return { deleted, kept, inventoryZeroed, customerDebtsZeroed, configReset };
    }
  );

  return {
    tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug },
    ...summary
  };
};

// ── Platform-run punto cero ──────────────────────────────────────────────────
//
// A platform (super) admin can run the full punto cero FOR a specific tenant.
// Both operations resolve the tenant on the master DB and then enter THAT
// tenant's ALS scope explicitly via `runWithTenancy`, so every scoped model
// (products, inventory, customers, suppliers, config) hits the tenant's own
// database. The platform request itself never leaks into a tenant scope.

/** Tenant header of a platform punto-cero view. */
export interface PlatformPuntoCeroTenant {
  id: string;
  name: string;
  slug: string;
}

/** Setup flags/balances for a tenant (the GET/POST `state` block). */
export interface PlatformPuntoCeroState {
  finalized: boolean;
  finalizedAt: string | null;
  openingBalances: { cash: number; mp: number; bank: number };
  /** Per-account one-time load timestamp (ISO) or null when still editable. */
  openingBalancesSetAt: { cash: string | null; mp: string | null; bank: string | null };
}

/** A tenant product with its current inventory quantity. */
export interface PlatformPuntoCeroProduct {
  id: string;
  name: string;
  maplesPerCajon: number;
  stock: number;
}

/** A tenant customer with its punto-cero opening debt. */
export interface PlatformPuntoCeroCustomer {
  id: string;
  name: string;
  openingDebt: number;
}

/** A tenant supplier with its punto-cero opening debt. */
export interface PlatformPuntoCeroSupplier {
  id: string;
  name: string;
  openingDebt: number;
}

/**
 * Full payload returned by BOTH platform punto-cero endpoints (GET and POST):
 * the tenant header plus its setup state, products (= current stock), customers
 * and suppliers. Customers/suppliers are NEVER filtered by `openingDebt > 0`
 * here — the platform admin needs the complete list to set the initial debt.
 */
export interface PlatformPuntoCeroView {
  tenant: PlatformPuntoCeroTenant;
  state: PlatformPuntoCeroState;
  products: PlatformPuntoCeroProduct[];
  customers: PlatformPuntoCeroCustomer[];
  suppliers: PlatformPuntoCeroSupplier[];
}

/**
 * Reads the tenant punto-cero snapshot. MUST be called inside the tenant's
 * `runWithTenancy` scope. Returns deterministic ordering (products, customers
 * and suppliers sorted by display name) and no sensitive fields.
 */
const readPuntoCeroSnapshot = async (): Promise<Omit<PlatformPuntoCeroView, 'tenant'>> => {
  const [config, products, inventories, customers, suppliers] = await Promise.all([
    getOrCreateConfig(),
    Product.find().select('variety caliber maplesPerCajon'),
    Inventory.find().select('productId quantity'),
    Customer.find().select('name openingDebt'),
    Supplier.find().select('name openingDebt')
  ]);

  const stockByProduct = new Map<string, number>();
  for (const inventory of inventories) {
    stockByProduct.set(String(inventory.productId), inventory.quantity);
  }

  const productViews = products
    .map<PlatformPuntoCeroProduct>((product) => ({
      id: String(product._id),
      name: displayName(product),
      maplesPerCajon: product.maplesPerCajon,
      stock: stockByProduct.get(String(product._id)) ?? 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const customerViews = customers
    .map<PlatformPuntoCeroCustomer>((customer) => ({
      id: String(customer._id),
      name: customer.name,
      openingDebt: customer.openingDebt
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const supplierViews = suppliers
    .map<PlatformPuntoCeroSupplier>((supplier) => ({
      id: String(supplier._id),
      name: supplier.name,
      openingDebt: supplier.openingDebt
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const setAt = config.openingBalancesSetAt;

  return {
    state: {
      finalized: config.puntoCeroFinalized,
      finalizedAt: config.puntoCeroFinalizedAt
        ? config.puntoCeroFinalizedAt.toISOString()
        : null,
      openingBalances: {
        cash: config.openingBalances?.cash ?? config.openingCash ?? 0,
        mp: config.openingBalances?.mp ?? 0,
        bank: config.openingBalances?.bank ?? 0
      },
      openingBalancesSetAt: {
        cash: setAt?.cash ? setAt.cash.toISOString() : null,
        mp: setAt?.mp ? setAt.mp.toISOString() : null,
        bank: setAt?.bank ? setAt.bank.toISOString() : null
      }
    },
    products: productViews,
    customers: customerViews,
    suppliers: supplierViews
  };
};

/**
 * `GET /v1/platform/tenants/:id/punto-cero` — the tenant's punto-cero state and
 * reference lists, read INSIDE that tenant's DB. Unknown tenant → 404.
 */
export const getPlatformPuntoCero = async (
  tenantId: string
): Promise<PlatformPuntoCeroView> => {
  const tenant = await resolveTenantById(tenantId);
  const connection = getTenantConnection(tenant.dbName);

  const snapshot = await runWithTenancy(
    { connection, tenantId: String(tenant._id) },
    () => readPuntoCeroSnapshot()
  );

  return {
    tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug },
    ...snapshot
  };
};

/**
 * `POST /v1/platform/tenants/:id/punto-cero` — runs the full punto cero FOR the
 * tenant, inside its own ALS scope.
 *
 * `force` is the explicit reset/correction switch (see `SetPuntoCeroOptions`):
 * without it a second run on an already-finalized tenant is the usual 409.
 *
 * The `createdBy` recorded on the appended `opening` StockTransactions is the
 * stable marker `platform:<platformAdminId>` — it identifies a platform-run
 * setup without pretending to be a tenant user id.
 *
 * Returns the refreshed full view (same shape as the GET), read after the write.
 */
export const setPlatformPuntoCero = async (
  tenantId: string,
  input: PlatformSetPuntoCeroInput,
  platformAdminId: string
): Promise<PlatformPuntoCeroView> => {
  const tenant = await resolveTenantById(tenantId);
  const connection = getTenantConnection(tenant.dbName);
  const { force, ...puntoCeroInput } = input;

  await runWithTenancy({ connection, tenantId: String(tenant._id) }, () =>
    setPuntoCero(puntoCeroInput, `platform:${platformAdminId}`, { force })
  );

  return getPlatformPuntoCero(tenantId);
};

// ── Platform-wide user management ────────────────────────────────────────────
//
// Platform admins manage users ACROSS every tenant. A user id is only unique
// inside its own tenant database, so mutating operations always require the
// owning `tenantId`; the service then opens that tenant's connection EXPLICITLY
// through `runWithTenancy` — platform requests never leak into a tenant's ALS
// scope. `passwordHash` is never selected nor serialized.

/** Admin-class roles that count towards the "keep at least one admin" guard. */
const ADMIN_ROLES: readonly UserRole[] = ['admin', 'superadmin'];

/** A tenant user enriched with its owning tenant for the platform UI. */
export interface PlatformUserView {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: string[];
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  createdAt: Date;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

/** Serializes a tenant user for the platform API — never exposes the hash. */
const toPlatformUserView = (user: IUser, tenant: ITenant): PlatformUserView => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  permissions: user.permissions ?? [],
  tenantId: String(tenant._id),
  tenantName: tenant.name,
  tenantSlug: tenant.slug,
  createdAt: user.createdAt
});

/** Resolves a tenant by id, failing closed with 404 when it does not exist. */
const resolveTenantById = async (tenantId: string): Promise<ITenant> => {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }
  return tenant;
};

/**
 * Refuses an operation that would leave a tenant without any admin-class user.
 * A tenant must always keep at least one `admin`/`superadmin`.
 */
const assertNotLastAdmin = async (
  connection: Connection,
  tenantId: string
): Promise<void> => {
  const adminCount = await runWithTenancy({ connection, tenantId }, () =>
    User.countDocuments({ role: { $in: ADMIN_ROLES } })
  );
  if (adminCount <= 1) {
    throw new AppError('A tenant must always keep at least one admin', 400);
  }
};

/**
 * Refuses an operation that would leave a tenant without any user who can
 * manage users. Superadmins always have access (they bypass the permission
 * check), so their presence satisfies the requirement even without an explicit
 * `users.manage`.
 */
const assertNotLastUserManager = async (
  connection: Connection,
  tenantId: string,
  excludeUserId: string
): Promise<void> => {
  const remaining = await runWithTenancy({ connection, tenantId }, () =>
    User.countDocuments({
      _id: { $ne: excludeUserId },
      $or: [{ role: 'superadmin' }, { role: 'admin', permissions: 'users.manage' }]
    })
  );
  if (remaining <= 0) {
    throw new AppError('At least one admin must keep user management permission', 409);
  }
};

/**
 * Lists users across ALL tenants (or a single tenant via `tenantId`), optionally
 * filtered by a case-insensitive `search` over name/email.
 *
 * Each tenant is queried on its own connection: an unreachable/empty tenant DB
 * is skipped (best-effort) instead of failing the whole request. The result is
 * sorted deterministically by tenant name, then user name.
 */
export const listPlatformUsers = async (input: {
  tenantId?: string;
  search?: string;
} = {}): Promise<PlatformUserView[]> => {
  const tenants = input.tenantId
    ? [await resolveTenantById(input.tenantId)]
    : await Tenant.find().sort({ name: 1 });

  const search = input.search?.trim().toLowerCase();
  const results: PlatformUserView[] = [];

  await Promise.all(
    tenants.map(async (tenant) => {
      try {
        const connection = getTenantConnection(tenant.dbName);
        const users = await runWithTenancy(
          { connection, tenantId: String(tenant._id) },
          () => User.find().select('name email role permissions createdAt').sort({ name: 1 })
        );
        for (const user of users) {
          if (search) {
            const haystack = `${user.name} ${user.email}`.toLowerCase();
            if (!haystack.includes(search)) continue;
          }
          results.push(toPlatformUserView(user, tenant));
        }
      } catch {
        // Unreachable tenant DB — skip it, never fail the whole request.
      }
    })
  );

  results.sort((a, b) => {
    const tenantCmp = a.tenantName.localeCompare(b.tenantName);
    if (tenantCmp !== 0) return tenantCmp;
    return a.name.localeCompare(b.name);
  });

  return results;
};

/**
 * Creates a user inside a specific tenant and indexes its email platform-wide.
 *
 * The unique `EmailIndex` is the platform-wide backstop: an insert failure
 * triggers a compensating delete of the just-created tenant user, so a failed
 * create never leaves an orphan behind (409 on a duplicate email).
 */
export const createPlatformUser = async (
  input: CreatePlatformUserInput
): Promise<PlatformUserView> => {
  const tenant = await resolveTenantById(input.tenantId);
  const tenantId = String(tenant._id);
  const connection = getTenantConnection(tenant.dbName);
  const email = input.email.trim().toLowerCase();

  // Fail fast for a platform-wide duplicate (the unique index is the backstop).
  const existingIndex = await EmailIndex.findOne({ email });
  if (existingIndex) {
    throw new AppError('Email already registered', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const permissions =
    input.role === 'admin'
      ? input.permissions !== undefined
        ? normalizePermissions(input.permissions)
        : [...DEFAULT_PERMISSIONS_BY_ROLE.admin]
      : [];
  let user: IUser;
  try {
    user = await runWithTenancy({ connection, tenantId }, () =>
      User.create({ name: input.name, email, passwordHash, role: input.role, permissions })
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError('Email already registered', 409);
    }
    throw error;
  }

  try {
    await EmailIndex.create({ email, tenantId: tenant._id, userId: user._id });
  } catch (error) {
    // Compensating rollback — never leave an orphaned tenant user behind.
    await runWithTenancy({ connection, tenantId }, () => user.deleteOne());
    if (isDuplicateKeyError(error)) {
      throw new AppError('Email already registered', 409);
    }
    throw error;
  }

  return toPlatformUserView(user, tenant);
};

/**
 * Updates a tenant user's `name`, `role` and/or `permissions`. Values are
 * validated by the caller's schema. Two guards apply:
 *  - demoting the last admin-class user of a tenant is refused with 400 (a tenant
 *    must always keep at least one admin);
 *  - removing `users.manage` from the last user manager is refused with 409.
 *
 * Permissions are only meaningful for admins. Non-admin roles always end up with
 * an empty permission list, and a role change to admin without an explicit list
 * applies the admin default.
 */
export const updatePlatformUser = async (
  userId: string,
  input: UpdatePlatformUserInput
): Promise<PlatformUserView> => {
  const tenant = await resolveTenantById(input.tenantId);
  const tenantId = String(tenant._id);
  const connection = getTenantConnection(tenant.dbName);

  const user = await runWithTenancy({ connection, tenantId }, () => User.findById(userId));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const currentPermissions = user.permissions ?? [];
  const targetRole: UserRole = input.role ?? user.role;
  const targetIsAdmin = ADMIN_ROLES.includes(targetRole);
  const roleChanged = input.role !== undefined && input.role !== user.role;

  let targetPermissions: string[];
  if (!targetIsAdmin) {
    targetPermissions = [];
  } else if (input.permissions !== undefined) {
    targetPermissions = normalizePermissions(input.permissions);
  } else if (roleChanged) {
    targetPermissions = [...DEFAULT_PERMISSIONS_BY_ROLE[targetRole]];
  } else {
    targetPermissions = currentPermissions;
  }

  if (roleChanged && ADMIN_ROLES.includes(user.role) && !targetIsAdmin) {
    await assertNotLastAdmin(connection, tenantId);
  }

  const losesUserManagement =
    ADMIN_ROLES.includes(user.role) &&
    currentPermissions.includes('users.manage') &&
    !(targetIsAdmin && targetPermissions.includes('users.manage'));
  if (losesUserManagement) {
    await assertNotLastUserManager(connection, tenantId, user._id.toString());
  }

  if (input.role !== undefined) {
    user.role = input.role;
  }
  if (input.permissions !== undefined || roleChanged) {
    user.permissions = targetPermissions;
  }
  if (input.name !== undefined) {
    user.name = input.name;
  }

  await runWithTenancy({ connection, tenantId }, () => user.save());

  return toPlatformUserView(user, tenant);
};

/**
 * Deletes a tenant user and its platform-wide `EmailIndex` row. Refuses (400)
 * to delete the last admin-class user of the tenant.
 */
export const deletePlatformUser = async (
  userId: string,
  tenantIdRaw: string
): Promise<void> => {
  const tenant = await resolveTenantById(tenantIdRaw);
  const tenantId = String(tenant._id);
  const connection = getTenantConnection(tenant.dbName);

  const user = await runWithTenancy({ connection, tenantId }, () => User.findById(userId));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (ADMIN_ROLES.includes(user.role)) {
    await assertNotLastAdmin(connection, tenantId);
  }

  await runWithTenancy({ connection, tenantId }, () => user.deleteOne());
  // Keep the platform-wide email index consistent with the tenant DB.
  await EmailIndex.deleteMany({ userId: user._id, tenantId: tenant._id });
};

/** Hashes and stores a new password for a tenant user (inside its context). */
export const resetPlatformUserPassword = async (
  userId: string,
  input: ResetPlatformUserPasswordInput
): Promise<void> => {
  const tenant = await resolveTenantById(input.tenantId);
  const tenantId = String(tenant._id);
  const connection = getTenantConnection(tenant.dbName);

  const user = await runWithTenancy({ connection, tenantId }, () => User.findById(userId));
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await runWithTenancy({ connection, tenantId }, async () => {
    user.passwordHash = passwordHash;
    // Kill every tenant session issued before the forced reset.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
  });
};
