import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { platformDbName } from '../tenancy/master.js';
import { Tenant, type ITenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { User } from '../modules/auth/model.js';

/**
 * Tenant-aware reset: clears ONE tenant's business data.
 *
 * Usage:
 *   npx tsx src/scripts/reset-all.ts --tenant <slug> --confirm <slug> [--include-users]
 *   # via npm:
 *   npm run tenant:reset -- --tenant huevo-lider --confirm huevo-lider
 *
 * Safety rails:
 *  - `--tenant` is REQUIRED — there is no default because resetting the wrong
 *    database is destructive and unrecoverable.
 *  - `--confirm <slug>` must match the tenant slug exactly before anything runs.
 *  - Only the tenant's own database is touched. The platform/master database
 *    (tenant registry, email index, platform admins) is NEVER dropped.
 *  - The tenant's users are preserved unless `--include-users` is passed.
 *  - Products are kept (reference data); every other business collection is
 *    dropped, including counters and BusinessConfig (Punto Cero).
 *
 * ⚠️ DESTRUCTIVE for the selected tenant — there is no undo.
 */

/** Reference/identity collections that survive a reset. */
const KEEP_COLLECTIONS = new Set(['users', 'products']);

interface ResetArgs {
  tenant?: string;
  confirm?: string;
  includeUsers: boolean;
}

const parseArgs = (argv: string[]): ResetArgs => {
  const args: ResetArgs = { includeUsers: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--tenant') {
      args.tenant = argv[i + 1];
      i++;
    } else if (arg.startsWith('--tenant=')) {
      args.tenant = arg.slice('--tenant='.length);
    } else if (arg === '--confirm') {
      args.confirm = argv[i + 1];
      i++;
    } else if (arg.startsWith('--confirm=')) {
      args.confirm = arg.slice('--confirm='.length);
    } else if (arg === '--include-users') {
      args.includeUsers = true;
    }
  }

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

  if (!args.tenant) {
    console.error('✗ Falta --tenant <slug>. Este script borra datos y no tiene tenant por defecto.');
    console.error('  Uso: npx tsx src/scripts/reset-all.ts --tenant <slug> --confirm <slug> [--include-users]');
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

  if (tenant.dbName === platformDbName) {
    console.error(`✗ El dbName del tenant (${tenant.dbName}) coincide con la base de plataforma. Abortado por seguridad.`);
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  if (args.confirm !== tenant.slug) {
    console.error(`✗ Confirmación inválida. Pasa --confirm ${tenant.slug} para confirmar el reset.`);
    console.error(`  Se borraría la base "${tenant.dbName}" del tenant "${tenant.name}".`);
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  console.log(`\n⚠  Reseteando tenant: ${tenant.name} (slug: ${tenant.slug})`);
  console.log(`   Base de datos objetivo: ${tenant.dbName}`);
  console.log(`   Usuarios: ${args.includeUsers ? 'SE REINICIAN (se conservan admin/superadmin)' : 'se conservan'}\n`);

  const connection = getTenantConnection(tenant.dbName);
  const db = connection.db;
  if (!db) throw new Error('No tenant database connection');

  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).filter((n) => !n.startsWith('system.'));

  let dropped = 0;
  for (const name of names) {
    if (KEEP_COLLECTIONS.has(name)) {
      console.log(`  ✓ mantener: ${name}`);
      continue;
    }
    await db.dropCollection(name);
    console.log(`  ✗ borrada: ${name}`);
    dropped++;
  }
  console.log(`\n${dropped} colecciones de negocio borradas.`);

  if (args.includeUsers) {
    const removed = await runWithTenancy(
      { connection, tenantId: String(tenant._id) },
      () => User.deleteMany({ role: { $nin: ['admin', 'superadmin'] } })
    );
    console.log(`Usuarios no-admin borrados: ${removed.deletedCount}`);
  }

  console.log('Contadores de secuencia reiniciados.');
  console.log('Punto Cero reseteado (finalized: false).');

  await mongoose.disconnect();
  console.log(`\nReset completo del tenant "${tenant.slug}". La app está lista para configurar el Punto Cero.`);
};

run().catch((error: unknown) => {
  console.error('Reset failed', error);
  process.exit(1);
});
