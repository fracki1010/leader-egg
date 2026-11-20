import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import supertest from 'supertest';
import { app } from '../app.js';
import { User } from '../modules/auth/model.js';
import { DEFAULT_PERMISSIONS_BY_ROLE } from '../modules/auth/permissions.js';
import { Product } from '../modules/products/model.js';
import { PriceEntry } from '../modules/products/price-list-model.js';
import { Customer } from '../modules/customers/model.js';
import { Order } from '../modules/orders/model.js';
import { Payment } from '../modules/payments/model.js';
import { Inventory } from '../modules/inventory/model.js';
import { resetBlacklist } from '../modules/auth/blacklist.js';
import { EmailIndex, Tenant } from '../tenancy/master-models.js';
import { refreshTenantCache } from '../tenancy/tenants.js';

export type TestAgent = ReturnType<typeof supertest>;

let mongod: MongoMemoryServer;

/**
 * Slug of the tenant that backs the default test connection.
 *
 * The test database IS the tenant database: its `dbName` is the default
 * connection's database name, so data seeded with plain `Model.create(...)`
 * (no ALS) is the same physical data served by authenticated tenant requests.
 */
export const TEST_TENANT_SLUG = 'test-tenant';

let testTenantId: string | null = null;

export const getTestTenantId = (): string => {
  if (!testTenantId) {
    throw new Error('Test tenant not initialised — call ensureTestTenant() first');
  }
  return testTenantId;
};

/**
 * Creates (or reuses) the Tenant record for the default test DB and refreshes
 * the in-memory tenant routing cache. Returns the tenant id.
 */
export const ensureTestTenant = async (): Promise<string> => {
  const dbName = mongoose.connection.name;
  let tenant = await Tenant.findOne({ slug: TEST_TENANT_SLUG });
  if (!tenant) {
    tenant = await Tenant.create({
      name: 'Test Tenant',
      slug: TEST_TENANT_SLUG,
      dbName,
      active: true
    });
  }
  testTenantId = String(tenant._id);
  await refreshTenantCache();
  return testTenantId;
};

/**
 * Registers a user in the platform-wide email index so tenant login can route
 * to it. Replaces any previous row for the same email (unique index).
 */
export const indexTestUser = async (
  email: string,
  userId: Types.ObjectId | string
): Promise<void> => {
  const normalized = email.trim().toLowerCase();
  await EmailIndex.deleteMany({ email: normalized });
  await EmailIndex.create({
    email: normalized,
    tenantId: getTestTenantId(),
    userId
  });
};

/**
 * Start in-memory MongoDB and connect mongoose.
 * Call once in beforeAll().
 */
export const startTestDatabase = async (): Promise<void> => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  await ensureTestTenant();
};

/**
 * Disconnect mongoose and stop in-memory MongoDB.
 * Call once in afterAll().
 */
export const stopTestDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
};

/**
 * Collects the base connection plus every connection created via
 * `useDb(..., { useCache: true })` (stored in the shared `relatedDbs` map).
 * Tenant models are compiled on those connections, so their collections must
 * be cleared too — otherwise data seeded via authenticated requests leaks
 * between tests.
 */
const collectConnections = (): mongoose.Connection[] => {
  const found = new Set<mongoose.Connection>();
  const visit = (conn: mongoose.Connection): void => {
    if (found.has(conn)) return;
    found.add(conn);
    const related = (conn as unknown as { relatedDbs?: Record<string, mongoose.Connection> })
      .relatedDbs;
    for (const child of Object.values(related ?? {})) visit(child);
  };
  for (const conn of mongoose.connections) visit(conn);
  return [...found];
};

/**
 * Clear all collections and reset in-memory state.
 * Call in beforeEach() to ensure test isolation.
 *
 * Clears every connection (tenant/default AND the master/platform connection),
 * then re-creates the routing tenant so logins keep working.
 */
export const clearDatabase = async (): Promise<void> => {
  for (const conn of collectConnections()) {
    for (const key of Object.keys(conn.collections)) {
      await conn.collections[key]!.deleteMany({});
    }
  }

  await resetBlacklist();
  await ensureTestTenant();
};

/**
 * Seed standard products with active prices and inventory records.
 *
 * Creates blanco×chico/mediano/grande + castaño×chico/mediano/grande with
 * active prices and inventory records. Returns the created docs so tests can
 * reference them by variety+caliber.
 */
export const seedProducts = async (): Promise<void> => {
  const products = await Product.create([
    { variety: 'blanco', caliber: 'chico', eggsPerMaple: 30 },
    { variety: 'blanco', caliber: 'mediano', eggsPerMaple: 30 },
    { variety: 'blanco', caliber: 'grande', eggsPerMaple: 30 },
    { variety: 'castaño', caliber: 'chico', eggsPerMaple: 30 },
    { variety: 'castaño', caliber: 'mediano', eggsPerMaple: 30 },
    { variety: 'castaño', caliber: 'grande', eggsPerMaple: 30 }
  ]);

  // Set active prices for each product (effective from yesterday, open-ended)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const priceEntries = products.map((p, i) => ({
    productId: p._id,
    price: 25 + i,
    effectiveFrom: yesterday
  }));
  await PriceEntry.create(priceEntries);

  // Create inventory records with default stock
  const inventoryEntries = products.map((p) => ({
    productId: p._id,
    quantity: 100,
    lastUpdated: new Date()
  }));
  await Inventory.create(inventoryEntries);
};

/**
 * Create an admin user and return credentials.
 */
export const seedAdminUser = async (): Promise<{ email: string; password: string }> => {
  const email = 'admin@test.com';
  const password = 'testpassword';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    name: 'Test Admin',
    email,
    passwordHash,
    role: 'admin',
    permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.admin]
  });
  await indexTestUser(email, user._id);

  return { email, password };
};

/**
 * Create a driver user and return credentials.
 */
export const seedDriverUser = async (): Promise<{ email: string; password: string }> => {
  const email = 'driver@test.com';
  const password = 'testpassword';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    name: 'Test Driver',
    email,
    passwordHash,
    role: 'driver'
  });
  await indexTestUser(email, user._id);

  return { email, password };
};

/**
 * Create a superadmin user and return credentials.
 *
 * The `superadmin` role is retired for new tenant users, but kept readable so
 * legacy data (tenant #1) keeps working — this helper exists for those tests.
 */
export const seedSuperAdminUser = async (): Promise<{ email: string; password: string }> => {
  const email = 'superadmin@test.com';
  const password = 'testpassword';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    name: 'Test Superadmin',
    email,
    passwordHash,
    role: 'superadmin',
    permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.superadmin]
  });
  await indexTestUser(email, user._id);

  return { email, password };
};

/**
 * Create a stall (puesto) user and return credentials.
 */
export const seedPuestoUser = async (): Promise<{ email: string; password: string }> => {
  const email = 'puesto@test.com';
  const password = 'testpassword';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    name: 'Test Puesto',
    email,
    passwordHash,
    role: 'puesto'
  });
  await indexTestUser(email, user._id);

  return { email, password };
};

/**
 * Login and return the JWT token.
 */
export const loginAs = async (
  agent: TestAgent,
  email: string,
  password: string
): Promise<string> => {
  const response = await agent
    .post('/api/v1/auth/login')
    .send({ email, password });

  return response.body.token as string;
};

/**
 * Get the product IDs from the database keyed by "variety-caliber" (assumes
 * seedProducts was called). E.g. productIds['blanco-chico'] → id.
 */
export const getProductIds = async (): Promise<Record<string, string>> => {
  const products = await Product.find().sort({ variety: 1, caliber: 1 });
  const map: Record<string, string> = {};
  for (const p of products) {
    map[`${p.variety}-${p.caliber}`] = p._id.toString();
  }
  return map;
};

/**
 * Create a B2C customer and return it.
 */
export const createTestCustomer = async (
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  const customer = await Customer.create({
    name: 'Test Customer',
    type: 'B2C',
    phone: '+1234567890',
    address: '123 Test St',
    ...overrides
  });
  return customer.toObject() as unknown as Record<string, unknown>;
};

/**
 * Create a B2C customer with credit config and return it.
 */
export const createCreditCustomer = async (
  creditLimit: number,
  termDays: number,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  return createTestCustomer({
    creditConfig: { limit: creditLimit, termDays },
    ...overrides
  });
};

export { app };
