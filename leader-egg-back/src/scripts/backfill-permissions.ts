import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Tenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { User } from '../modules/auth/model.js';
import { ALL_PERMISSIONS } from '../modules/auth/permissions.js';

/**
 * One-time backfill for the per-module permission system.
 *
 * Existing tenant users predate the `permissions` field. This script gives every
 * admin/superadmin the full permission set (so admin-only routes keep working)
 * and normalizes every other role to an empty list.
 *
 * The migration is idempotent: users that already have a non-empty permission
 * list for admin-class roles, or an empty list for the rest, are left untouched.
 *
 * Usage (from leader-egg-back):
 *   npx tsx src/scripts/backfill-permissions.ts
 *   npx tsx src/scripts/backfill-permissions.ts --dry-run
 *   # or against a remote/Atlas URI:
 *   MONGO_URI="mongodb+srv://user:pass@host/leader_egg" npx tsx src/scripts/backfill-permissions.ts
 */

const ADMIN_ROLES = ['admin', 'superadmin'] as const;

interface TenantBackfillResult {
  tenantSlug: string;
  dbName: string;
  adminsBackfilled: number;
  nonAdminsNormalized: number;
}

const parseArgs = (argv: string[]): { dryRun: boolean } => ({
  dryRun: argv.includes('--dry-run')
});

const run = async (): Promise<void> => {
  const { dryRun } = parseArgs(process.argv.slice(2));

  await mongoose.connect(env.MONGO_URI);
  console.log(`Connected to ${env.MONGO_URI}`);
  if (dryRun) {
    console.log('DRY RUN — no documents will be modified.');
  }

  const tenants = await Tenant.find().sort({ slug: 1 });
  if (tenants.length === 0) {
    console.log('No tenants registered — nothing to backfill.');
    await mongoose.disconnect();
    return;
  }

  const results: TenantBackfillResult[] = [];

  for (const tenant of tenants) {
    const connection = getTenantConnection(tenant.dbName);
    const tenantId = String(tenant._id);

    const result = await runWithTenancy({ connection, tenantId }, async () => {
      const adminFilter = {
        role: { $in: ADMIN_ROLES },
        $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }]
      };
      const nonAdminFilter = {
        role: { $nin: ADMIN_ROLES },
        $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }]
      };

      const adminsBackfilled = await User.countDocuments(adminFilter);
      const nonAdminsNormalized = await User.countDocuments(nonAdminFilter);

      if (!dryRun) {
        if (adminsBackfilled > 0) {
          await User.updateMany(adminFilter, { $set: { permissions: ALL_PERMISSIONS } });
        }
        if (nonAdminsNormalized > 0) {
          await User.updateMany(nonAdminFilter, { $set: { permissions: [] } });
        }
      }

      return {
        tenantSlug: tenant.slug,
        dbName: tenant.dbName,
        adminsBackfilled,
        nonAdminsNormalized
      } satisfies TenantBackfillResult;
    });

    results.push(result);
    console.log(
      `Tenant ${result.tenantSlug} (${result.dbName}): ` +
        `${result.adminsBackfilled} admin(s) → full permissions, ` +
        `${result.nonAdminsNormalized} non-admin(s) → []`
    );
  }

  const totalAdmins = results.reduce((sum, r) => sum + r.adminsBackfilled, 0);
  const totalNonAdmins = results.reduce((sum, r) => sum + r.nonAdminsNormalized, 0);
  console.log(
    `${dryRun ? 'Would update' : 'Updated'} ${totalAdmins} admin(s) and ` +
      `${totalNonAdmins} non-admin(s) across ${results.length} tenant(s).`
  );

  await mongoose.disconnect();
  console.log('Done');
};

run().catch((error: unknown) => {
  console.error('Permission backfill failed', error);
  process.exit(1);
});
