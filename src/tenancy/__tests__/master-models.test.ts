import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getMasterConnection, platformDbName } from '../master.js';
import { Tenant, EmailIndex, PlatformAdmin } from '../master-models.js';
import { runWithTenancy } from '../context.js';
import { getTenantConnection } from '../registry.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('master platform models', () => {
  it('resolve on the platform connection, never the default connection', () => {
    expect(Tenant.db.name).toBe(platformDbName);
    expect(EmailIndex.db.name).toBe(platformDbName);
    expect(PlatformAdmin.db.name).toBe(platformDbName);

    expect(Tenant.db).toBe(getMasterConnection());
    expect(Tenant.db).not.toBe(mongoose.connection);
  });

  it('do not route into a tenant connection inside runWithTenancy', () => {
    const tenantConn = getTenantConnection('tenant_master_check');

    runWithTenancy({ connection: tenantConn, tenantId: 'some-tenant' }, () => {
      expect(Tenant.db).toBe(getMasterConnection());
      expect(Tenant.db.name).toBe(platformDbName);
      expect(Tenant.db).not.toBe(tenantConn);

      expect(EmailIndex.db.name).toBe(platformDbName);
      expect(PlatformAdmin.db.name).toBe(platformDbName);
    });
  });

  it('persists Tenant/EmailIndex/PlatformAdmin in the platform DB only', async () => {
    await Tenant.create({ name: 'Master Check', slug: 'master-check', dbName: 'tenant_master_check' });

    const onPlatform = await getMasterConnection().collection('tenants').countDocuments();
    const onDefault = await mongoose.connection.collection('tenants').countDocuments();

    expect(onPlatform).toBe(1);
    expect(onDefault).toBe(0);
  });
});
