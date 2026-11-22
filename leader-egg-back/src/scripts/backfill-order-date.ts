import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { platformDbName } from '../tenancy/master.js';
import { Tenant, type ITenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { Order } from '../modules/orders/model.js';
import { normalizeOrderDate } from '../modules/orders/service.js';

/**
 * Backfills the business/sale date (`orderDate`) on legacy orders.
 *
 * Orders created before `orderDate` existed have no business date, so the
 * date-based views fall back to their capture timestamp (`createdAt`). This
 * script pins each one to the date the sale actually happened, using the
 * historical date the business typed into the delivery plan:
 *
 *   orderDate = normalizeOrderDate(deliveryDate ?? createdAt)
 *
 * The normalization is the same rule the API applies on create/update: local
 * noon of the intended calendar day (see `normalizeOrderDate` in
 * `modules/orders/service.ts`).
 *
 * Usage (from leader-egg-back):
 *   npm run orders:backfill-date                      # every active tenant
 *   npm run orders:backfill-date -- --tenant <slug>   # one tenant
 *   npm run orders:backfill-date -- --dry-run         # print the plan only
 *   npx tsx src/scripts/backfill-order-date.ts --tenant <slug> --dry-run
 *
 * Idempotent: only documents with a missing `orderDate` are touched, never
 * the field itself or `updatedAt`. Safe to run again.
 */

interface BackfillArgs {
  tenant?: string;
  dryRun: boolean;
}

const parseArgs = (argv: string[]): BackfillArgs => {
  const args: BackfillArgs = { dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--tenant') {
      args.tenant = argv[i + 1];
      i++;
    } else if (arg.startsWith('--tenant=')) {
      args.tenant = arg.slice('--tenant='.length);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
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

/** Counts the legacy orders of one tenant that still lack a business date. */
const countMissingOrders = async (tenant: ITenant): Promise<number> => {
  const connection = getTenantConnection(tenant.dbName);
  return runWithTenancy(
    { connection, tenantId: String(tenant._id) },
    () => Order.countDocuments({ orderDate: { $exists: false } })
  );
};

/** Applies the backfill to one tenant. Idempotent: only missing docs are touched. */
const backfillTenant = async (tenant: ITenant): Promise<number> => {
  const connection = getTenantConnection(tenant.dbName);

  return runWithTenancy(
    { connection, tenantId: String(tenant._id) },
    async () => {
      let updated = 0;
      const cursor = Order.find({ orderDate: { $exists: false } })
        .select('_id deliveryDate createdAt')
        .lean()
        .cursor();

      for await (const order of cursor) {
        const source = order.deliveryDate ?? order.createdAt ?? new Date();
        await Order.updateOne(
          { _id: order._id },
          { $set: { orderDate: normalizeOrderDate(source) } },
          // Audit columns stay untouched: the backfill is not a business edit.
          { timestamps: false }
        );
        updated += 1;
      }

      return updated;
    }
  );
};

const run = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to database');

  const tenants = args.tenant
    ? [await resolveTenant(args.tenant)]
    : await Tenant.find().sort({ createdAt: 1 });

  if (tenants.length === 0 || tenants.some((tenant) => tenant === null)) {
    console.error(
      args.tenant
        ? `✗ No se encontró el tenant "${args.tenant}".`
        : '✗ No hay tenants activos registrados.'
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const selected = tenants as ITenant[];
  console.log(
    args.dryRun
      ? `\nModo DRY-RUN — no se escribirá nada. Tenants objetivo: ${selected.length}`
      : `\nBackfill de orderDate — tenants objetivo: ${selected.length}`
  );
  console.log('Regla: orderDate = normalizeOrderDate(deliveryDate ?? createdAt)');
  console.log('Solo se tocan órdenes sin orderDate; updatedAt no cambia.\n');

  // Phase 1 — plan: count what each tenant is missing BEFORE touching anything.
  const plan: Array<{ tenant: ITenant; missing: number }> = [];
  let totalMissing = 0;

  for (const tenant of selected) {
    if (tenant.dbName === platformDbName) {
      console.log(`  ⚠ ${tenant.slug}: es la base de plataforma — se omite.`);
      continue;
    }

    const missing = await countMissingOrders(tenant);
    plan.push({ tenant, missing });
    totalMissing += missing;
    console.log(`  ${tenant.slug} (${tenant.dbName}): ${missing} orden(es) sin orderDate`);
  }

  if (args.dryRun || totalMissing === 0) {
    console.log(
      totalMissing === 0
        ? '\nNo hay nada para actualizar.'
        : '\nEjecutá sin --dry-run para aplicar el backfill.'
    );
    await mongoose.disconnect();
    console.log('Done');
    return;
  }

  // Phase 2 — apply.
  console.log('');
  let totalUpdated = 0;

  for (const { tenant, missing } of plan) {
    if (missing === 0) {
      continue;
    }
    const updated = await backfillTenant(tenant);
    totalUpdated += updated;
    console.log(`  ${tenant.slug} (${tenant.dbName}): actualizadas=${updated}`);
  }

  console.log(`\nTotal: ${totalMissing} órdenes sin orderDate, ${totalUpdated} actualizadas.`);

  await mongoose.disconnect();
  console.log('Done');
};

run().catch((error: unknown) => {
  console.error('Backfill failed', error);
  process.exit(1);
});
