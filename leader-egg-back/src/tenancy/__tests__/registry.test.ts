import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getTenantConnection, registerModels, TENANT_MODEL_NAMES } from '../registry.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('registerModels', () => {
  it('compiles every tenant model once and is idempotent', () => {
    const conn = mongoose.connection.useDb('registry_idempotent', { useCache: true });
    expect(Object.keys(conn.models)).toHaveLength(0);

    registerModels(conn);
    const afterFirst = Object.keys(conn.models);
    const userModel = conn.models['User'];

    registerModels(conn);
    const afterSecond = Object.keys(conn.models);

    expect(afterFirst).toHaveLength(TENANT_MODEL_NAMES.length);
    expect(afterSecond).toHaveLength(TENANT_MODEL_NAMES.length);
    expect(afterSecond.sort()).toEqual(afterFirst.sort());
    // Same model instance → the second call did not recompile.
    expect(conn.models['User']).toBe(userModel);
  });
});

describe('getTenantConnection', () => {
  it('returns a cached connection whose resolved db name is the requested name', () => {
    const conn = getTenantConnection('tenant_x');

    expect(conn.name).toBe('tenant_x');
    expect(conn.models['Order']).toBeDefined();
    expect(conn.models['Product']).toBeDefined();

    // Cached: the same dbName yields the same Connection with the same models.
    const again = getTenantConnection('tenant_x');
    expect(again).toBe(conn);
    expect(Object.keys(again.models).sort()).toEqual(Object.keys(conn.models).sort());
  });
});
