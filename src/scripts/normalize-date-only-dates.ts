import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { platformDbName } from '../tenancy/master.js';
import { Tenant, type ITenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';

/**
 * Re-anchors legacy date-only documents at 12:00 UTC.
 *
 * Every manual date entered through a native `<input type="date">` arrives as
 * a date-only string ('YYYY-MM-DD'). Parsed as a `Date` it becomes UTC
 * midnight, which in ART (UTC-3) is 21:00 of the PREVIOUS day — so those
 * records appeared one day early in Caja, the daily close, the customer ledger
 * and every list.
 *
 * The API now anchors new values at noon UTC (09:00 ART of the intended day).
 * This script repairs what was already stored: for each target collection it
 * shifts ONLY documents whose `date` sits exactly at UTC midnight by +12 hours.
 * Anything else (real instants, already-normalized noon values) is untouched.
 *
 * Usage (from leader-egg-back):
 *   npm run dates:normalize                      # every active tenant
 *   npm run dates:normalize -- --tenant <slug>   # one tenant
 *   npm run dates:normalize -- --dry-run         # print the plan only
 *   npx tsx src/scripts/normalize-date-only-dates.ts --tenant <slug> --dry-run
 *
 * Idempotent: after the shift the value is noon UTC, so a second run finds
 * nothing. Writes go through the raw driver, so `updatedAt` is never touched
 * (equivalent to Mongoose `{ timestamps: false }`).
 */

interface NormalizeArgs {
  tenant?: string;
  dryRun: boolean;
}

interface Target {
  /** Physical collection name in every tenant database. */
  collection: string;
  field: string;
}

const TARGETS: Target[] = [
  { collection: 'expenses', field: 'date' },
  { collection: 'cashadjustments', field: 'date' },
  { collection: 'customercharges', field: 'date' },
  { collection: 'payments', field: 'date' },
  { collection: 'purchases', field: 'date' }
];

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const parseArgs = (argv: string[]): NormalizeArgs => {
  const args: NormalizeArgs = { dryRun: false };

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

const isUtcMidnight = (value: Date): boolean =>
  value.getUTCHours() === 0 &&
  value.getUTCMinutes() === 0 &&
  value.getUTCSeconds() === 0 &&
  value.getUTCMilliseconds() === 0;

interface TargetResult {
  collection: string;
  candidates: number;
  updated: number;
  sampleBefore?: string;
  sampleAfter?: string;
}

/** Normalizes every target collection of one tenant. Idempotent. */
const normalizeTenant = async (tenant: ITenant, dryRun: boolean): Promise<TargetResult[]> => {
  const connection = getTenantConnection(tenant.dbName);
  const results: TargetResult[] = [];

  for (const target of TARGETS) {
    const collection = connection.collection(target.collection);
    const cursor = collection
      .find({ [target.field]: { $type: 'date' } })
      .project({ _id: 1, [target.field]: 1 })
      .batchSize(500);

    let candidates = 0;
    let updated = 0;
    let sampleBefore: string | undefined;
    let sampleAfter: string | undefined;

    for await (const doc of cursor) {
      const current = doc[target.field] as Date | null;
      if (!(current instanceof Date) || !isUtcMidnight(current)) continue;

      candidates += 1;
      const shifted = new Date(current.getTime() + TWELVE_HOURS_MS);
      if (sampleBefore === undefined) {
        sampleBefore = current.toISOString();
        sampleAfter = shifted.toISOString();
      }

      if (!dryRun) {
        // Precise filter: only rewrite the exact value we inspected. Raw driver
        // writes never touch updatedAt.
        await collection.updateOne(
          { _id: doc._id, [target.field]: current },
          { $set: { [target.field]: shifted } }
        );
        updated += 1;
      }
    }

    results.push({ collection: target.collection, candidates, updated, sampleBefore, sampleAfter });
  }

  return results;
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
      : `\nNormalización de fechas date-only — tenants objetivo: ${selected.length}`
  );
  console.log('Regla: solo documentos con date exactamente a 00:00:00.000 UTC → +12h (mediodía UTC).');
  console.log('updatedAt no cambia.\n');

  let totalCandidates = 0;
  let totalUpdated = 0;

  for (const tenant of selected) {
    if (tenant.dbName === platformDbName) {
      console.log(`  ⚠ ${tenant.slug}: es la base de plataforma — se omite.`);
      continue;
    }

    const results = await normalizeTenant(tenant, args.dryRun);
    console.log(`  ${tenant.slug} (${tenant.dbName}):`);

    for (const result of results) {
      totalCandidates += result.candidates;
      totalUpdated += result.updated;
      const sample =
        result.sampleBefore && result.sampleAfter
          ? ` · ejemplo: ${result.sampleBefore} → ${result.sampleAfter}`
          : '';
      console.log(
        `    ${result.collection}: ${result.candidates} a normalizar, ${result.updated} actualizadas${sample}`
      );
    }
  }

  console.log(
    args.dryRun
      ? `\nTotal: ${totalCandidates} documentos a normalizar (no se escribió nada).`
      : `\nTotal: ${totalCandidates} documentos candidatos, ${totalUpdated} actualizados.`
  );

  await mongoose.disconnect();
  console.log('Done');
};

run().catch((error: unknown) => {
  console.error('Normalization failed', error);
  process.exit(1);
});
