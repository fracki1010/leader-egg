import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Tenant, type ITenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { User } from '../modules/auth/model.js';

/**
 * Promotes a user to the tenant `admin` role inside one tenant's database.
 *
 * Replaces the retired `promote-superadmin` script: the tenant `superadmin`
 * role was retired in the multi-tenant refactor (platform admins are a separate
 * master entity managed through the platform module). A tenant-level admin is
 * the highest tenant role.
 *
 * Usage:
 *   npx tsx src/scripts/promote-admin.ts --tenant <slug> --email <email>
 *   npx tsx src/scripts/promote-admin.ts <slug> <email>
 *
 * NOTE: an already-issued JWT keeps the old role. The user must log out and log
 * back in to receive a token carrying the new role.
 */

interface PromoteArgs {
  tenant?: string;
  email?: string;
}

const parseArgs = (argv: string[]): PromoteArgs => {
  const args: PromoteArgs = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--tenant') {
      args.tenant = argv[i + 1];
      i++;
    } else if (arg.startsWith('--tenant=')) {
      args.tenant = arg.slice('--tenant='.length);
    } else if (arg === '--email') {
      args.email = argv[i + 1];
      i++;
    } else if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length);
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  args.tenant ??= positional[0];
  args.email ??= positional[1];
  return args;
};

/** Resolves a tenant by slug, dbName or ObjectId from the platform registry. */
const resolveTenant = async (value: string): Promise<ITenant | null> => {
  const trimmed = value.trim();
  const bySlugOrDb = await Tenant.findOne({
    $or: [{ slug: trimmed.toLowerCase() }, { dbName: trimmed }]
  });
  if (bySlugOrDb) return bySlugOrDb;
  if (mongoose.Types.ObjectId.isValid(trimmed)) return Tenant.findById(trimmed);
  return null;
};

const run = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.tenant || !args.email) {
    console.error('✗ Faltan argumentos. Se requieren --tenant <slug> y --email <email>.');
    console.error('  Uso: npx tsx src/scripts/promote-admin.ts --tenant <slug> --email <email>');
    process.exitCode = 2;
    return;
  }

  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to database');

  const tenant = await resolveTenant(args.tenant);
  if (!tenant) {
    console.error(`✗ No se encontró el tenant "${args.tenant}".`);
    console.error('  Registra los tenants con: npx tsx src/scripts/bootstrap-multitenant.ts');
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const email = args.email.trim().toLowerCase();
  const connection = getTenantConnection(tenant.dbName);

  const result = await runWithTenancy(
    { connection, tenantId: String(tenant._id) },
    () => User.updateOne({ email }, { $set: { role: 'admin' } })
  );

  console.log(`Tenant: ${tenant.name} (slug: ${tenant.slug}, db: ${tenant.dbName})`);
  console.log(`Email: ${email}`);
  console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);

  if (result.matchedCount === 0) {
    console.warn(`⚠ No se encontró ningún usuario con email ${email} en el tenant "${tenant.slug}".`);
  } else {
    console.log('El usuario ahora tiene el rol "admin". Debe volver a iniciar sesión para refrescar su token.');
  }

  await mongoose.disconnect();
  console.log('Done');
};

run().catch((error: unknown) => {
  console.error('Promote failed', error);
  process.exit(1);
});
