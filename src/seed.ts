import './config/setup.js';
import bcrypt from 'bcrypt';
import mongoose, { type Connection } from 'mongoose';
import { env } from './config/env.js';
import { runWithTenancy } from './tenancy/context.js';
import { getTenantConnection } from './tenancy/registry.js';
import { Tenant, type ITenant } from './tenancy/master-models.js';
import { User, type UserRole } from './modules/auth/model.js';
import { DEFAULT_PERMISSIONS_BY_ROLE } from './modules/auth/permissions.js';
import { Customer } from './modules/customers/model.js';
import { Product, CALIBERS, VARIETIES, displayName, type ProductVariety } from './modules/products/model.js';
import { Inventory } from './modules/inventory/model.js';
import { PriceEntry } from './modules/products/price-list-model.js';

/** Default cost prices per variety × caliber. */
const DEFAULT_COST_PRICE: Record<string, number> = {
  'blanco-chico': 18.00,
  'blanco-mediano': 18.50,
  'blanco-grande': 19.00,
  'blanco-extragrande': 20.00,
  'blanco-surtido': 18.00,
  'castaño-chico': 15.50,
  'castaño-mediano': 16.00,
  'castaño-grande': 16.50,
  'castaño-extragrande': 17.00,
  'castaño-surtido': 15.50,
};

const PRODUCTS: Array<{ variety: ProductVariety; caliber: typeof CALIBERS[number] }> = [];
for (const variety of VARIETIES) {
  for (const caliber of CALIBERS) {
    PRODUCTS.push({ variety, caliber });
  }
}

const ADMIN_EMAIL = 'admin@leaderegg.com';
const ADMIN_NAME = 'Admin';
const ADMIN_PASSWORD = 'admin123';

const PUESTO_USER_EMAIL = 'puesto@leaderegg.com';
const PUESTO_USER_NAME = 'Empleado Puesto';
const PUESTO_USER_PASSWORD = 'puesto123';

/** B2C no-credit system customer used by walk-in stall sales (design D6). */
const WALK_IN_CUSTOMER_NAME = 'Puesto (mostrador)';

/**
 * Options for {@link seedTenantData}. All optional so the seed can be tuned per
 * tenant. The admin user is only created/updated when `adminEmail` is provided.
 */
export interface SeedTenantOptions {
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
  /** Role for the tenant admin user. Defaults to `'admin'` (tenant-level). */
  adminRole?: UserRole;
  /** Also seed the demo puesto (stall) user. Defaults to `false`. */
  includeDemoUsers?: boolean;
}

// ── Individual seed steps (all idempotent) ───────────────────────────────────

/** Seeds the 10 variety × caliber products with zero-quantity inventory. */
const seedProductsAndInventory = async (): Promise<void> => {
  const existingCount = await Product.countDocuments({
    variety: { $in: [...VARIETIES] },
    caliber: { $in: [...CALIBERS] }
  });

  if (existingCount === PRODUCTS.length) {
    // All 10 products exist — still ensure inventory records exist for each
    const products = await Product.find({
      variety: { $in: [...VARIETIES] },
      caliber: { $in: [...CALIBERS] }
    });
    for (const product of products) {
      const existingInventory = await Inventory.findOne({ productId: product._id });
      if (!existingInventory) {
        await Inventory.create({
          productId: product._id,
          quantity: 0,
          lastUpdated: new Date()
        });
        console.log(`Created inventory for "${displayName(product)}"`);
      }
    }
    console.log('Products already seeded, skipping');
    return;
  }

  // Clean start — delete ALL existing products + inventory + price entries
  console.log('Cleaning legacy products, inventory and price entries...');

  const priceResult = await PriceEntry.deleteMany({});
  console.log(`Deleted ${priceResult.deletedCount ?? 0} price entries`);

  const invResult = await Inventory.deleteMany({});
  console.log(`Deleted ${invResult.deletedCount ?? 0} inventory records`);

  const prodResult = await Product.deleteMany({});
  console.log(`Deleted ${prodResult.deletedCount ?? 0} products`);

  for (const { variety, caliber } of PRODUCTS) {
    const costPrice = DEFAULT_COST_PRICE[`${variety}-${caliber}`] ?? 0;
    const created = await Product.create({
      variety,
      caliber,
      eggsPerMaple: 30,
      maplesPerCajon: 12,
      costPrice,
      lowStockThreshold: 20
    });
    console.log(`Created product: ${displayName({ variety, caliber })}`);

    await Inventory.create({
      productId: created._id,
      quantity: 0,
      lastUpdated: new Date()
    });
  }
  console.log(`Created ${PRODUCTS.length} products with inventory`);
};

/** Seeds the walk-in system customer used by stall sales (keyed by name). */
const seedWalkInCustomer = async (): Promise<void> => {
  const existingWalkIn = await Customer.findOne({ name: WALK_IN_CUSTOMER_NAME });
  if (existingWalkIn) {
    console.log(`Customer "${WALK_IN_CUSTOMER_NAME}" already exists, skipping`);
    return;
  }
  await Customer.create({
    name: WALK_IN_CUSTOMER_NAME,
    type: 'B2C',
    phone: 'Sin teléfono',
    address: 'Mostrador del puesto',
    creditConfig: { limit: 0, termDays: 0 }
  });
  console.log(`Created walk-in customer "${WALK_IN_CUSTOMER_NAME}"`);
};

/**
 * Creates (or reconciles) the tenant admin user. Idempotent: an existing user
 * with the same email has its role reconciled to `adminRole`.
 */
const seedTenantAdmin = async (options: SeedTenantOptions): Promise<void> => {
  const { adminEmail } = options;
  if (!adminEmail) return;

  const adminRole = options.adminRole ?? 'admin';
  const existingAdmin = await User.findOne({ email: adminEmail });

  if (existingAdmin) {
    if (existingAdmin.role !== adminRole) {
      existingAdmin.role = adminRole;
      if ((adminRole === 'admin' || adminRole === 'superadmin') && (existingAdmin.permissions ?? []).length === 0) {
        existingAdmin.permissions = [...DEFAULT_PERMISSIONS_BY_ROLE[adminRole]];
      }
      await existingAdmin.save();
      console.log(`Updated admin user role to ${adminRole}`);
    } else {
      console.log('Admin user already exists, skipping');
    }
    return;
  }

  if (!options.adminPassword) {
    throw new Error(`Cannot create admin user ${adminEmail}: adminPassword is required`);
  }

  const passwordHash = await bcrypt.hash(options.adminPassword, 10);
  await User.create({
    name: options.adminName ?? 'Admin',
    email: adminEmail,
    passwordHash,
    role: adminRole,
    permissions:
      adminRole === 'admin' || adminRole === 'superadmin'
        ? [...DEFAULT_PERMISSIONS_BY_ROLE[adminRole]]
        : []
  });
  console.log(`Created ${adminRole} user`);
};

/** Seeds the demo puesto (stall) user (keyed by email). */
const seedPuestoUser = async (): Promise<void> => {
  const existingPuesto = await User.findOne({ email: PUESTO_USER_EMAIL });
  if (existingPuesto) {
    console.log('Puesto user already exists, skipping');
    return;
  }
  const passwordHash = await bcrypt.hash(PUESTO_USER_PASSWORD, 10);
  await User.create({
    name: PUESTO_USER_NAME,
    email: PUESTO_USER_EMAIL,
    passwordHash,
    role: 'puesto'
  });
  console.log('Created puesto user');
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Seeds one tenant's data on `connection`, bound to `tenantId` via tenancy
 * context. Idempotent — safe to re-run.
 *
 * Seeds: the 10 variety × caliber products (+ zero-quantity inventory), the
 * walk-in system customer, the tenant admin user (when `adminEmail` is given),
 * and optionally the demo puesto user (`includeDemoUsers`).
 *
 * Used by tenant provisioning (`provisionTenant`) and the seed CLI.
 */
export const seedTenantData = async (
  connection: Connection,
  tenantId: string | null,
  options: SeedTenantOptions = {}
): Promise<void> => {
  await runWithTenancy({ connection, tenantId }, async () => {
    await seedProductsAndInventory();
    await seedWalkInCustomer();
    await seedTenantAdmin(options);
    if (options.includeDemoUsers) {
      await seedPuestoUser();
    }
  });
};

/**
 * Legacy single-database seed. Seeds the default connection with the historical
 * superadmin + puesto demo users. Preserved so `npm run seed` and the existing
 * seed tests keep working unchanged.
 */
export const seedDatabase = async (): Promise<void> => {
  await seedTenantData(mongoose.connection, null, {
    adminName: ADMIN_NAME,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    adminRole: 'superadmin',
    includeDemoUsers: true
  });
};

// ── Tenant-aware CLI ─────────────────────────────────────────────────────────

/** Slug of the default tenant (historical `leader_egg` database). */
const DEFAULT_TENANT_SLUG = 'huevo-lider';

interface SeedCliArgs {
  tenant?: string;
  email?: string;
  password?: string;
  role?: UserRole;
}

/** Parses `--flag value` / `--flag=value` pairs plus one optional positional. */
const parseSeedArgs = (argv: string[]): SeedCliArgs => {
  const args: SeedCliArgs = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = argv[i + 1];
    if (arg === '--tenant') {
      args.tenant = value;
      i++;
    } else if (arg.startsWith('--tenant=')) {
      args.tenant = arg.slice('--tenant='.length);
    } else if (arg === '--email') {
      args.email = value;
      i++;
    } else if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length);
    } else if (arg === '--password') {
      args.password = value;
      i++;
    } else if (arg.startsWith('--password=')) {
      args.password = arg.slice('--password='.length);
    } else if (arg === '--role') {
      args.role = value as UserRole | undefined;
      i++;
    } else if (arg.startsWith('--role=')) {
      args.role = arg.slice('--role='.length) as UserRole;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  // Positional fallback: `npx tsx src/seed.ts huevo-lider`
  args.tenant ??= positional[0];
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

/**
 * Seeds one resolved tenant's database.
 *
 * Tenant #1 (`huevo-lider`) keeps the historical options (legacy superadmin +
 * demo puesto user); every other tenant gets products + walk-in customer and,
 * when `--email` is supplied, a tenant `admin` user.
 */
const seedTenantForCli = async (tenant: ITenant, args: SeedCliArgs): Promise<void> => {
  const connection = getTenantConnection(tenant.dbName);
  const tenantId = String(tenant._id);
  const isDefaultTenant = tenant.slug === DEFAULT_TENANT_SLUG;

  const options: SeedTenantOptions = isDefaultTenant
    ? {
        adminName: ADMIN_NAME,
        adminEmail: ADMIN_EMAIL,
        adminPassword: ADMIN_PASSWORD,
        adminRole: 'superadmin',
        includeDemoUsers: true
      }
    : {};

  if (args.email) {
    options.adminEmail = args.email.trim().toLowerCase();
    options.adminName ??= 'Admin';
    options.adminPassword = args.password;
    options.adminRole = args.role ?? (isDefaultTenant ? 'superadmin' : 'admin');
  }

  await seedTenantData(connection, tenantId, options);
};

// CLI entry — runs only when executed directly (tsx src/seed.ts), not when
// the module is imported (e.g. by the seed idempotency test). The project
// compiles to CommonJS, so the classic require.main === module guard applies.
const isMain = typeof require !== 'undefined' && require.main === module;

if (isMain) {
  const args = parseSeedArgs(process.argv.slice(2));
  const tenantRef = args.tenant ?? DEFAULT_TENANT_SLUG;

  const run = async (): Promise<void> => {
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to database');

    const tenant = await resolveTenant(tenantRef);
    if (!tenant) {
      console.error(`\n✗ No se encontró el tenant "${tenantRef}".`);
      console.error('  Registra los tenants con: npx tsx src/scripts/bootstrap-multitenant.ts');
      console.error('  Luego vuelve a ejecutar: npm run seed -- --tenant <slug>');
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }

    console.log(`Seeding tenant: ${tenant.name} (slug: ${tenant.slug}, db: ${tenant.dbName})`);
    await seedTenantForCli(tenant, args);
    await mongoose.disconnect();
    console.log('Seed complete');
  };

  run().catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exit(1);
  });
}
