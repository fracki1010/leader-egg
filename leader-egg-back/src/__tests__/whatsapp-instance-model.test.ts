import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { WhatsappInstance } from '../tenancy/master-models.js';
import { startTestDatabase, stopTestDatabase, clearDatabase } from './helpers.js';

describe('WhatsappInstance master model', () => {
  beforeAll(async () => {
    await startTestDatabase();
    await WhatsappInstance.init();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('defaults state to created and stamps stateUpdatedAt', async () => {
    const instance = await WhatsappInstance.create({
      tenantId: new Types.ObjectId(),
      instanceName: 'tenant-acme'
    });

    expect(instance.state).toBe('created');
    expect(instance.stateUpdatedAt).toBeInstanceOf(Date);
  });

  it('allows at most one routing record per tenant', async () => {
    const tenantId = new Types.ObjectId();
    await WhatsappInstance.create({ tenantId, instanceName: 'tenant-acme' });

    await expect(
      WhatsappInstance.create({ tenantId, instanceName: 'tenant-acme-2' })
    ).rejects.toThrow(/E11000/);
  });

  it('enforces a unique instanceName across tenants', async () => {
    await WhatsappInstance.create({
      tenantId: new Types.ObjectId(),
      instanceName: 'tenant-acme'
    });

    await expect(
      WhatsappInstance.create({ tenantId: new Types.ObjectId(), instanceName: 'tenant-acme' })
    ).rejects.toThrow(/E11000/);
  });
});
