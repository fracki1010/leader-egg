import mongoose, { type Connection } from 'mongoose';
import { env } from '../config/env.js';

/**
 * Master (platform) connection.
 *
 * ## How `MONGO_URI` relates to `PLATFORM_DB`
 *
 * `MONGO_URI` points at the cluster. Its path segment is the *default*
 * database for `mongoose.connection` (kept for legacy reasons: the deployed
 * backend historically connected MONGO_URI straight to `leader_egg`).
 *
 * Master data does NOT live on that default connection. It lives on a
 * dedicated database resolved through `useDb`, whose name is `PLATFORM_DB`
 * (default `leader_egg_platform`) on the SAME cluster:
 *
 *   MONGO_URI = mongodb+srv://.../leader_egg        ← base pool / legacy default
 *   PLATFORM_DB = leader_egg_platform               ← Tenant + EmailIndex + PlatformAdmin
 *   tenant #1 dbName = leader_egg                   ← untouched business data
 *
 * This keeps the existing deployment working: `getTenantConnection('leader_egg')`
 * returns exactly the current data, while the new platform collections are
 * created in their own database.
 */
export const platformDbName = env.PLATFORM_DB;

/**
 * Database names that must never be used as the platform DB: they belong to
 * tenants. `leader_egg` is the primary/legacy tenant's database.
 */
const RESERVED_TENANT_DB_NAMES = new Set(['leader_egg']);

/** Prefix every provisioned tenant database name is built from. */
const TENANT_DB_PREFIX = 'tenant_';

/**
 * Pure platform-DB safety check. Throws a fatal configuration error when the
 * platform DB would collide with tenant data or the default connection:
 *
 *  - `platformDb` must differ from the base `MONGO_URI` database
 *  - `platformDb` must not use the reserved `tenant_` prefix
 *  - `platformDb` must not be a reserved tenant database name (`leader_egg`)
 *
 * Exported separately from {@link assertPlatformDbSafe} so it can be unit
 * tested with arbitrary names without mutating the environment.
 */
export const assertPlatformDbSafety = (platformDb: string, baseDbName?: string): void => {
  if (baseDbName && platformDb === baseDbName) {
    throw new Error(
      `Fatal configuration error: PLATFORM_DB ("${platformDb}") collides with the ` +
        `MONGO_URI database ("${baseDbName}"). Master data (tenant registry, email ` +
        'index, platform admins) must live in its own database. Set PLATFORM_DB to a ' +
        'distinct name.'
    );
  }

  if (platformDb.startsWith(TENANT_DB_PREFIX)) {
    throw new Error(
      `Fatal configuration error: PLATFORM_DB ("${platformDb}") must not use the ` +
        `reserved "${TENANT_DB_PREFIX}" prefix — that namespace is reserved for tenant databases.`
    );
  }

  if (RESERVED_TENANT_DB_NAMES.has(platformDb)) {
    throw new Error(
      `Fatal configuration error: PLATFORM_DB ("${platformDb}") is a reserved tenant ` +
        'database name. Master data must live in a dedicated database (e.g. leader_egg_platform).'
    );
  }
};

/**
 * Asserts the configured {@link platformDbName} is safe against the currently
 * connected base database. Called from `connectDatabase()` so the app refuses
 * to boot on a misconfigured `PLATFORM_DB` (fail fast).
 *
 * `baseDbName` defaults to `mongoose.connection.name`; pass an explicit value
 * in tests. When the base connection has no resolved database name, only the
 * static checks (prefix + reserved names) run.
 */
export const assertPlatformDbSafe = (
  baseDbName: string | undefined = mongoose.connection.name
): void => assertPlatformDbSafety(platformDbName, baseDbName || undefined);


/**
 * Returns the stable Connection bound to the platform database.
 *
 * `useDb(..., { useCache: true })` guarantees a single Connection (and a single
 * set of models) per process, sharing the base connection pool. Never returns
 * the default `mongoose.connection`, so master models can never be routed into
 * a tenant database.
 */
export const getMasterConnection = (): Connection =>
  mongoose.connection.useDb(platformDbName, { useCache: true });
