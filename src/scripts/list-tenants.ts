import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { platformDbName } from '../tenancy/master.js';
import { Tenant } from '../tenancy/master-models.js';

/**
 * Lists every tenant registered in the platform/master database.
 *
 * Usage:
 *   npx tsx src/scripts/list-tenants.ts
 *   # via npm:
 *   npm run tenants:list
 */

const pad = (value: string, width: number): string => value.padEnd(width, ' ');

const run = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);

  try {
    const tenants = await Tenant.find().sort({ createdAt: 1 });

    console.log(`Platform DB: ${platformDbName}`);
    console.log(`Tenants: ${tenants.length}`);

    if (tenants.length === 0) {
      console.log('\n(ninguno) Registra tenants con: npx tsx src/scripts/bootstrap-multitenant.ts');
      return;
    }

    const rows = tenants.map((t) => ({
      name: t.name,
      slug: t.slug,
      dbName: t.dbName,
      active: t.active ? 'yes' : 'no',
      createdAt: t.createdAt.toISOString()
    }));

    const nameWidth = Math.max('NAME'.length, ...rows.map((r) => r.name.length));
    const slugWidth = Math.max('SLUG'.length, ...rows.map((r) => r.slug.length));
    const dbWidth = Math.max('DBNAME'.length, ...rows.map((r) => r.dbName.length));

    console.log('');
    console.log(
      `${pad('NAME', nameWidth)}  ${pad('SLUG', slugWidth)}  ${pad('DBNAME', dbWidth)}  ACTIVE  CREATED`
    );
    console.log(
      `${'-'.repeat(nameWidth)}  ${'-'.repeat(slugWidth)}  ${'-'.repeat(dbWidth)}  ------  -------`
    );
    for (const row of rows) {
      console.log(
        `${pad(row.name, nameWidth)}  ${pad(row.slug, slugWidth)}  ${pad(row.dbName, dbWidth)}  ${pad(row.active, 6)}  ${row.createdAt}`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error: unknown) => {
  console.error('List tenants failed', error);
  process.exit(1);
});
