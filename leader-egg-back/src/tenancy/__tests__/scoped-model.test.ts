import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Schema } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { runWithTenancy } from '../context.js';
import { createScopedModel } from '../scoped-model.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

interface IWidget {
  name: string;
}

const widgetSchema = new Schema<IWidget>({ name: String });
const Widget = createScopedModel<IWidget>('ScopedWidget', widgetSchema);

describe('createScopedModel', () => {
  it('resolves on the default (master) connection when there is no ALS context', () => {
    expect(Widget.db).toBe(mongoose.connection);
    expect(Widget.db.name).toBe(mongoose.connection.name);
  });

  it('resolves on the ALS connection inside runWithTenancy', () => {
    const connA = mongoose.connection.useDb('scoped_db_a', { useCache: true });

    runWithTenancy({ connection: connA, tenantId: 'a' }, () => {
      expect(Widget.db).toBe(connA);
      expect(Widget.db.name).toBe('scoped_db_a');
    });
  });

  it('resolves the same model name to different databases per context', () => {
    const connA = mongoose.connection.useDb('isolation_a', { useCache: true });
    const connB = mongoose.connection.useDb('isolation_b', { useCache: true });

    const nameA = runWithTenancy({ connection: connA, tenantId: 'a' }, () => Widget.db.name);
    const nameB = runWithTenancy({ connection: connB, tenantId: 'b' }, () => Widget.db.name);

    expect(nameA).toBe('isolation_a');
    expect(nameB).toBe('isolation_b');
    expect(nameA).not.toBe(nameB);
  });

  it('does not leak the tenant connection once the ALS scope exits', () => {
    const connA = mongoose.connection.useDb('scoped_db_a', { useCache: true });

    runWithTenancy({ connection: connA, tenantId: 'a' }, () => {
      expect(Widget.db).toBe(connA);
    });

    expect(Widget.db).toBe(mongoose.connection);
  });

  it('keeps data isolated between context databases', async () => {
    const connA = mongoose.connection.useDb('write_a', { useCache: true });
    const connB = mongoose.connection.useDb('write_b', { useCache: true });

    await runWithTenancy({ connection: connA, tenantId: 'a' }, () => Widget.create({ name: 'a' }));
    await runWithTenancy({ connection: connB, tenantId: 'b' }, () => Widget.create({ name: 'b' }));

    const countA = await runWithTenancy({ connection: connA, tenantId: 'a' }, () =>
      Widget.countDocuments()
    );
    const countB = await runWithTenancy({ connection: connB, tenantId: 'b' }, () =>
      Widget.countDocuments()
    );

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});
