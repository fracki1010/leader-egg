import '../config/setup.js';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { platformDbName } from '../tenancy/master.js';
import { Tenant, EmailIndex, PlatformAdmin, type ITenant } from '../tenancy/master-models.js';
import { getTenantConnection, registerModels } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { refreshTenantCache } from '../tenancy/tenants.js';
import { User } from '../modules/auth/model.js';

/**
 * Bootstrap the multi-tenant platform — idempotent, safe to re-run.
 *
 * Usage:
 *   npx tsx src/scripts/bootstrap-multitenant.ts
 *   npx tsx src/scripts/bootstrap-multitenant.ts --email=admin@platform.com --password=secret123
 *   # or via env: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD
 *
 * Steps:
 *  1. Ensure the platform models exist (syncIndexes on Tenant/EmailIndex/PlatformAdmin)
 *  2. Create the platform admin (if none exists)
 *  3. Register the EXISTING `leader_egg` DB as tenant #1 (if not already registered)
 *  4. Backfill the email index from the existing `leader_egg` users
 *  5. Log a summary
 *
 * It NEVER modifies existing business data in `leader_egg` (read-only there).
 */

const TENANT1 = {
  name: 'El Huevo Líder',
  slug: 'huevo-lider',
  dbName: 'leader_egg'
} as const;

interface CliArgs {
  email?: string;
  password?: string;
}

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = {};
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length);
    } else if (arg.startsWith('--password=')) {
      args.password = arg.slice('--password='.length);
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  // Positional fallback: <email> <password>
  args.email ??= positional[0];
  args.password ??= positional[1];
  return args;
};

/**
 * Returns true when `indexes` contains a unique index whose key has `field`
 * ascending. Used to verify `syncIndexes()` actually produced the platform-wide
 * uniqueness guarantees login routing depends on.
 */
const hasUniqueIndexOn = (
  indexes: Array<{ key?: Record<string, unknown>; unique?: boolean }>,
  field: string
): boolean => indexes.some((index) => index.unique === true && index.key?.[field] === 1);

/**
 * Ensures the platform models exist and their UNIQUE indexes are present.
 *
 * Unlike a best-effort sync, any index-sync failure now aborts the bootstrap:
 * platform-wide email/slug/dbName uniqueness is load-bearing (a duplicate
 * EmailIndex row would route logins to an arbitrary tenant). After syncing, the
 * unique indexes are verified explicitly and a clear error is thrown if missing.
 */
export const ensurePlatformModels = async (): Promise<void> => {
  for (const model of [Tenant, EmailIndex, PlatformAdmin]) {
    await model.syncIndexes();
  }

  const tenantIndexes = (await Tenant.collection.indexes()) as Array<{
    key?: Record<string, unknown>;
    unique?: boolean;
  }>;
  for (const field of ['slug', 'dbName'] as const) {
    if (!hasUniqueIndexOn(tenantIndexes, field)) {
      throw new Error(
        `Platform bootstrap aborted: Tenant is missing the unique index on \`${field}\`. ` +
          'Tenant registry uniqueness would be unenforced.'
      );
    }
  }

  const emailIndexes = (await EmailIndex.collection.indexes()) as Array<{
    key?: Record<string, unknown>;
    unique?: boolean;
  }>;
  if (!hasUniqueIndexOn(emailIndexes, 'email')) {
    throw new Error(
      'Platform bootstrap aborted: EmailIndex is missing the unique index on `email`. ' +
        'Login routing would be ambiguous and could resolve to an arbitrary tenant.'
    );
  }

  const adminIndexes = (await PlatformAdmin.collection.indexes()) as Array<{
    key?: Record<string, unknown>;
    unique?: boolean;
  }>;
  if (!hasUniqueIndexOn(adminIndexes, 'email')) {
    throw new Error(
      'Platform bootstrap aborted: PlatformAdmin is missing the unique index on `email`.'
    );
  }
};

const ensurePlatformAdmin = async (args: CliArgs): Promise<'created' | 'exists' | 'skipped'> => {
  const email = (args.email ?? process.env.PLATFORM_ADMIN_EMAIL)?.trim().toLowerCase();
  const password = args.password ?? process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email) {
    console.warn('No PLATFORM_ADMIN_EMAIL / --email provided — skipping platform admin creation.');
    return 'skipped';
  }

  const existing = await PlatformAdmin.findOne({ email });
  if (existing) {
    return 'exists';
  }

  if (!password) {
    console.warn('No PLATFORM_ADMIN_PASSWORD / --password provided — cannot create platform admin.');
    return 'skipped';
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await PlatformAdmin.create({
    name: process.env.PLATFORM_ADMIN_NAME?.trim() || 'Platform Admin',
    email,
    passwordHash
  });
  return 'created';
};

const ensureTenant1 = async (): Promise<{ tenant: ITenant; status: 'created' | 'exists' }> => {
  const existing = await Tenant.findOne({ $or: [{ slug: TENANT1.slug }, { dbName: TENANT1.dbName }] });
  if (existing) {
    return { tenant: existing, status: 'exists' };
  }
  const tenant = await Tenant.create({ ...TENANT1, active: true });
  return { tenant, status: 'created' };
};

const backfillEmailIndex = async (tenant: ITenant): Promise<number> => {
  const connection = getTenantConnection(tenant.dbName);
  registerModels(connection);

  // Read-only access to the existing tenant DB.
  const users = await runWithTenancy({ connection, tenantId: String(tenant._id) }, () =>
    User.find().select('_id email')
  );

  let indexed = 0;
  for (const user of users) {
    const email = user.email?.trim().toLowerCase();
    if (!email) continue;

    const already = await EmailIndex.findOne({ email });
    if (already) continue;

    await EmailIndex.create({
      email,
      tenantId: tenant._id,
      userId: user._id
    });
    indexed++;
  }
  return indexed;
};

export const bootstrapMultitenant = async (args: CliArgs = {}): Promise<void> => {
  console.log(`Platform DB: ${platformDbName}`);

  await ensurePlatformModels();
  console.log('Platform models ready.');

  const adminStatus = await ensurePlatformAdmin(args);
  console.log(`Platform admin: ${adminStatus}.`);

  const { tenant, status } = await ensureTenant1();
  console.log(`Tenant #1 (${TENANT1.dbName}): ${status}.`);

  const indexed = await backfillEmailIndex(tenant);
  console.log(`Emails indexed: ${indexed}.`);

  await refreshTenantCache();
  console.log('\nBootstrap summary:');
  console.log(`  - Platform admin: ${adminStatus}`);
  console.log(`  - Tenant #1: ${status}`);
  console.log(`  - Emails indexed this run: ${indexed}`);
};

const isMain = typeof require !== 'undefined' && require.main === module;

if (isMain) {
  const run = async (): Promise<void> => {
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to database');
    try {
      await bootstrapMultitenant(parseArgs(process.argv.slice(2)));
    } finally {
      await mongoose.disconnect();
      console.log('Done');
    }
  };

  run().catch((error: unknown) => {
    console.error('Bootstrap failed', error);
    process.exit(1);
  });
}
