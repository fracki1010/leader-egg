import { Types } from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { User } from '../modules/auth/model.js';
import { runWithTenancy } from './context.js';
import { Tenant, EmailIndex, type ITenant } from './master-models.js';
import { getTenantConnection } from './registry.js';
import { platformDbName } from './master.js';
import { seedTenantData } from '../seed.js';

/**
 * Tenant registry, in-memory cache, and lifecycle (provisioning/deprovisioning).
 *
 * All registry reads/writes go through the master models (platform DB). Tenant
 * business data is only ever touched on the tenant's own connection.
 */

/** Slug rules: lowercase letters, digits and hyphens only. */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Primary/legacy tenant database. Dropping it is refused unless the caller
 * passes an explicit `allowPrimary: true` — it holds the original production
 * business data and there is no undo.
 */
export const PRIMARY_TENANT_DB_NAME = 'leader_egg';

/** Lightweight, plain-object tenant shape kept in memory for request routing. */
export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  dbName: string;
  active: boolean;
  plan?: string;
}

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  plan?: string;
}

// ── Registry lookups ─────────────────────────────────────────────────────────

export const getTenantBySlug = (slug: string): Promise<ITenant | null> =>
  Tenant.findOne({ slug: slug.trim().toLowerCase() });

export const getTenantById = (id: string): Promise<ITenant | null> =>
  Types.ObjectId.isValid(id) ? Tenant.findById(id) : Promise.resolve(null);

export const getTenantByDbName = (dbName: string): Promise<ITenant | null> =>
  Tenant.findOne({ dbName });

// ── In-memory cache ──────────────────────────────────────────────────────────

const cacheById = new Map<string, TenantRecord>();
const cacheByDbName = new Map<string, TenantRecord>();

const toRecord = (tenant: ITenant): TenantRecord => ({
  id: String(tenant._id),
  name: tenant.name,
  slug: tenant.slug,
  dbName: tenant.dbName,
  active: tenant.active,
  plan: tenant.plan ?? undefined
});

/** (Re)loads the in-memory tenant cache from the platform DB. */
export const loadTenantCache = async (): Promise<void> => {
  const tenants = await Tenant.find();
  cacheById.clear();
  cacheByDbName.clear();
  for (const tenant of tenants) {
    const record = toRecord(tenant);
    cacheById.set(record.id, record);
    cacheByDbName.set(record.dbName, record);
  }
};

/** Alias for {@link loadTenantCache} — refreshes the cache after mutations. */
export const refreshTenantCache = (): Promise<void> => loadTenantCache();

export const getTenantFromCache = (id: string): TenantRecord | undefined => cacheById.get(id);

export const getTenantFromCacheByDbName = (dbName: string): TenantRecord | undefined =>
  cacheByDbName.get(dbName);

// ── Provisioning ─────────────────────────────────────────────────────────────

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

/** Drops the tenant DB and removes all platform rows created for it. */
const rollbackProvisioning = async (tenant: ITenant): Promise<void> => {
  await EmailIndex.deleteMany({ tenantId: tenant._id });
  try {
    await getTenantConnection(tenant.dbName).dropDatabase();
  } catch {
    // The DB may not exist yet (failure before/at creation) — best-effort cleanup.
  }
  await Tenant.deleteOne({ _id: tenant._id });
  await refreshTenantCache();
};

/**
 * Provisions a new tenant:
 *  1. validates the slug and rejects duplicate slug/dbName (409)
 *  2. creates the master `Tenant` document (`dbName = tenant_<slug>`)
 *  3. seeds the tenant DB (10 products + inventory, walk-in customer, admin user)
 *  4. indexes the admin email → { tenantId, userId } for login routing
 *  5. refreshes the cache
 *
 * Any failure after tenant creation triggers a compensating rollback (drop the
 * tenant DB, delete EmailIndex rows and the Tenant document).
 */
export const provisionTenant = async (input: ProvisionTenantInput): Promise<ITenant> => {
  const slug = input.slug.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError('Invalid tenant slug: use lowercase letters, digits and hyphens', 400);
  }

  const dbName = `tenant_${slug}`;

  const duplicate = await Tenant.findOne({ $or: [{ slug }, { dbName }] });
  if (duplicate) {
    throw new AppError('Tenant slug or database name already in use', 409);
  }

  const tenant = await Tenant.create({
    name: input.name.trim(),
    slug,
    dbName,
    active: true,
    plan: input.plan
  });

  try {
    const connection = getTenantConnection(dbName);
    const tenantId = String(tenant._id);

    // Seed the tenant: products + inventory, walk-in customer, admin user.
    await seedTenantData(connection, tenantId, {
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      adminPassword: input.adminPassword,
      adminRole: 'admin'
    });

    // Resolve the freshly seeded admin user to build the platform email index.
    const adminUser = await runWithTenancy({ connection, tenantId }, () =>
      User.findOne({ email: input.adminEmail.trim().toLowerCase() })
    );
    if (!adminUser) {
      throw new Error(`Tenant admin user ${input.adminEmail} was not created during seeding`);
    }

    await EmailIndex.create({
      email: input.adminEmail.trim().toLowerCase(),
      tenantId: tenant._id,
      userId: adminUser._id
    });
  } catch (error) {
    await rollbackProvisioning(tenant);
    if (isDuplicateKeyError(error)) {
      throw new AppError('Tenant admin email is already registered on the platform', 409);
    }
    throw error;
  }

  await refreshTenantCache();
  return tenant;
};

/**
 * Deprovisions a tenant. Requires `confirm === tenant.slug` as a deletion
 * guard. Drops the tenant database and removes its platform rows.
 *
 * Safety rails (all additive to the slug confirmation):
 *  - NEVER touches the master/platform database: `tenant.dbName === platformDbName`
 *    is rejected with 400.
 *  - The primary/legacy tenant (`leader_egg`) is refused unless the caller
 *    explicitly opts in with `{ allowPrimary: true }` (default = refuse).
 */
export const deprovisionTenant = async (
  tenantId: string,
  options: { confirm: string; allowPrimary?: boolean }
): Promise<void> => {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }

  // The platform/master database must never be dropped, even with a matching
  // confirmation slug.
  if (tenant.dbName === platformDbName) {
    throw new AppError('Cannot deprovision the platform database', 400);
  }

  // The primary/legacy tenant is protected by default. Dropping it requires an
  // explicit opt-in because there is no undo.
  if (tenant.dbName === PRIMARY_TENANT_DB_NAME && options.allowPrimary !== true) {
    throw new AppError(
      'Refusing to deprovision the primary tenant database. Pass allowPrimary: true to confirm. / ' +
        'Se rechaza eliminar la base de datos del tenant primario. Usa allowPrimary: true para confirmar.',
      400
    );
  }

  if (options.confirm !== tenant.slug) {
    throw new AppError('Confirmation slug does not match the tenant slug', 400);
  }

  await getTenantConnection(tenant.dbName).dropDatabase();
  await EmailIndex.deleteMany({ tenantId: tenant._id });
  await Tenant.deleteOne({ _id: tenant._id });
  await refreshTenantCache();
};

/** Marks a tenant inactive. */
export const suspendTenant = async (tenantId: string): Promise<ITenant> => {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }
  tenant.active = false;
  await tenant.save();
  await refreshTenantCache();
  return tenant;
};

/** Marks a tenant active again. */
export const activateTenant = async (tenantId: string): Promise<ITenant> => {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    throw new AppError('Tenant not found', 404);
  }
  tenant.active = true;
  await tenant.save();
  await refreshTenantCache();
  return tenant;
};
