import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  provisionTenant,
  deprovisionTenant,
  refreshTenantCache,
  getTenantFromCache,
  PRIMARY_TENANT_DB_NAME
} from '../tenants.js';
import { platformDbName } from '../master.js';
import { getTenantConnection } from '../registry.js';
import { runWithTenancy } from '../context.js';
import { Tenant, EmailIndex } from '../master-models.js';
import { Product } from '../../modules/products/model.js';
import { Customer } from '../../modules/customers/model.js';
import { User } from '../../modules/auth/model.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

beforeEach(async () => {
  await Tenant.deleteMany({});
  await EmailIndex.deleteMany({});
  await dropTenantDatabases();
  await refreshTenantCache();
});

const scoped = <T>(dbName: string, tenantId: string, fn: () => T): T =>
  runWithTenancy({ connection: getTenantConnection(dbName), tenantId }, fn);

describe('provisionTenant', () => {
  it('creates the tenant DB with 10 products, the admin user and an EmailIndex row', async () => {
    const tenant = await provisionTenant({
      name: 'Test Co',
      slug: 'test-co',
      adminName: 'Test Admin',
      adminEmail: 'a@test.com',
      adminPassword: 'secret123'
    });

    expect(tenant.dbName).toBe('tenant_test-co');
    expect(tenant.slug).toBe('test-co');
    expect(tenant.active).toBe(true);

    const dbName = tenant.dbName;
    const tenantId = String(tenant._id);

    const products = await scoped(dbName, tenantId, () => Product.find());
    expect(products).toHaveLength(10);

    const walkIn = await scoped(dbName, tenantId, () =>
      Customer.findOne({ name: 'Puesto (mostrador)' })
    );
    expect(walkIn).not.toBeNull();

    const admin = await scoped(dbName, tenantId, () => User.findOne({ email: 'a@test.com' }));
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe('admin');

    const index = await EmailIndex.findOne({ email: 'a@test.com' });
    expect(index).not.toBeNull();
    expect(String(index!.tenantId)).toBe(tenantId);
    expect(String(index!.userId)).toBe(String(admin!._id));

    // Cache is refreshed on create.
    expect(getTenantFromCache(tenantId)?.dbName).toBe('tenant_test-co');
  });

  it('rejects a duplicate slug with 409', async () => {
    const base = {
      name: 'Dup Co',
      slug: 'dup-co',
      adminName: 'Admin',
      adminPassword: 'secret123'
    };

    await provisionTenant({ ...base, adminEmail: 'first@dup.com' });

    await expect(
      provisionTenant({ ...base, adminEmail: 'second@dup.com' })
    ).rejects.toMatchObject({ status: 409 });

    // The failed attempt did not register a second tenant.
    expect(await Tenant.countDocuments({ slug: 'dup-co' })).toBe(1);
  });

  it('rejects an invalid slug with 400', async () => {
    await expect(
      provisionTenant({
        name: 'Bad Co',
        slug: 'Bad Slug!',
        adminName: 'Admin',
        adminEmail: 'bad@test.com',
        adminPassword: 'secret123'
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('deprovisionTenant', () => {
  it('requires the matching slug confirmation and drops the tenant DB', async () => {
    const tenant = await provisionTenant({
      name: 'Del Co',
      slug: 'del-co',
      adminName: 'Admin',
      adminEmail: 'del@test.com',
      adminPassword: 'secret123'
    });

    await expect(
      deprovisionTenant(String(tenant._id), { confirm: 'wrong-slug' })
    ).rejects.toMatchObject({ status: 400 });

    expect(await Tenant.findById(tenant._id)).not.toBeNull();

    await deprovisionTenant(String(tenant._id), { confirm: 'del-co' });

    expect(await Tenant.findById(tenant._id)).toBeNull();
    expect(await EmailIndex.countDocuments({ tenantId: tenant._id })).toBe(0);

    const { databases } = await mongoose.connection.db!.admin().listDatabases();
    expect(databases.map((d) => d.name)).not.toContain('tenant_del-co');
  });

  it('refuses to deprovision the platform database even with a matching confirmation', async () => {
    // A registry row that points at the platform DB (should never be created by
    // provisioning, but a corrupt/legacy row must not be able to drop it).
    const platformTenant = await Tenant.create({
      name: 'Platform DB tenant',
      slug: 'platform-db',
      dbName: platformDbName,
      active: true
    });

    await expect(
      deprovisionTenant(String(platformTenant._id), { confirm: 'platform-db' })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/platform database/i) });

    // Nothing was dropped: the row still exists (read back from the platform DB).
    expect(await Tenant.findById(platformTenant._id)).not.toBeNull();
  });

  it('refuses to deprovision the primary tenant unless allowPrimary is explicit', async () => {
    const primary = await Tenant.create({
      name: 'Primary tenant',
      slug: 'primary',
      dbName: PRIMARY_TENANT_DB_NAME,
      active: true
    });

    await expect(
      deprovisionTenant(String(primary._id), { confirm: 'primary' })
    ).rejects.toMatchObject({ status: 400 });
    expect(await Tenant.findById(primary._id)).not.toBeNull();

    // Explicit opt-in allows it (drops the separate `leader_egg` DB).
    await deprovisionTenant(String(primary._id), { confirm: 'primary', allowPrimary: true });
    expect(await Tenant.findById(primary._id)).toBeNull();
  });
});

describe('tenant isolation', () => {
  it('keeps each tenant products and users visible only under its own scope', async () => {
    const t1 = await provisionTenant({
      name: 'Iso A',
      slug: 'iso-a',
      adminName: 'A Admin',
      adminEmail: 'a@iso.com',
      adminPassword: 'secret123'
    });
    const t2 = await provisionTenant({
      name: 'Iso B',
      slug: 'iso-b',
      adminName: 'B Admin',
      adminEmail: 'b@iso.com',
      adminPassword: 'secret123'
    });

    const id1 = String(t1._id);
    const id2 = String(t2._id);

    expect(await scoped('tenant_iso-a', id1, () => Product.countDocuments())).toBe(10);
    expect(await scoped('tenant_iso-b', id2, () => Product.countDocuments())).toBe(10);

    // Mutating tenant 1 must not touch tenant 2.
    await scoped('tenant_iso-a', id1, () => Product.deleteMany({}));
    expect(await scoped('tenant_iso-a', id1, () => Product.countDocuments())).toBe(0);
    expect(await scoped('tenant_iso-b', id2, () => Product.countDocuments())).toBe(10);

    // Users are isolated too: tenant 1 cannot see tenant 2's admin.
    expect(await scoped('tenant_iso-a', id1, () => User.findOne({ email: 'b@iso.com' }))).toBeNull();
    expect(await scoped('tenant_iso-b', id2, () => User.findOne({ email: 'a@iso.com' }))).toBeNull();

    // Nothing leaked onto the default/master connection.
    expect(await Product.countDocuments()).toBe(0);
  });
});
