import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ensurePlatformModels } from '../bootstrap-multitenant.js';
import { Tenant, EmailIndex, PlatformAdmin } from '../../tenancy/master-models.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

interface IndexInfo {
  key?: Record<string, unknown>;
  unique?: boolean;
}

/**
 * The bootstrap must fail hard on index errors rather than warn: platform-wide
 * email/slug/dbName uniqueness depends on these indexes. This test proves the
 * unique indexes are actually created AND verified.
 */
describe('ensurePlatformModels', () => {
  it('syncs and verifies the platform unique indexes', async () => {
    await expect(ensurePlatformModels()).resolves.toBeUndefined();

    const tenantIndexes = (await Tenant.collection.indexes()) as IndexInfo[];
    expect(tenantIndexes.some((i) => i.unique === true && i.key?.slug === 1)).toBe(true);
    expect(tenantIndexes.some((i) => i.unique === true && i.key?.dbName === 1)).toBe(true);

    const emailIndexes = (await EmailIndex.collection.indexes()) as IndexInfo[];
    expect(emailIndexes.some((i) => i.unique === true && i.key?.email === 1)).toBe(true);

    const adminIndexes = (await PlatformAdmin.collection.indexes()) as IndexInfo[];
    expect(adminIndexes.some((i) => i.unique === true && i.key?.email === 1)).toBe(true);
  });
});
