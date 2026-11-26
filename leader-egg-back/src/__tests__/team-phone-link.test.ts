import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs,
  getTestTenantId,
  indexTestUser
} from './helpers.js';
import { app } from '../app.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { User } from '../modules/auth/model.js';
import { WhatsappAllowedNumber } from '../modules/whatsapp/model.js';

const request = supertest(app);

/** Runs a callback inside the test tenant, the way the app runs tenant routes. */
const inTenant = <T>(callback: () => Promise<T>): Promise<T> =>
  runWithTenancy(
    { connection: getTenantConnection(mongoose.connection.name), tenantId: getTestTenantId() },
    callback
  );

const linkFor = (phone: string) => inTenant(() => WhatsappAllowedNumber.findOne({ phone }).lean());

describe('team WhatsApp phone link (admin sets a number on a user)', () => {
  let adminToken: string;
  let driverToken: string;
  let targetId: string;
  let otherId: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    const admin = await seedAdminUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    const driver = await seedDriverUser();
    driverToken = await loginAs(request, driver.email, driver.password);

    const target = await User.create({ name: 'Target', email: 'target@test.com', passwordHash: 'x', role: 'driver' });
    await indexTestUser('target@test.com', target._id);
    targetId = String(target._id);

    const other = await User.create({ name: 'Other', email: 'other@test.com', passwordHash: 'x', role: 'driver' });
    await indexTestUser('other@test.com', other._id);
    otherId = String(other._id);
  });

  const put = (id: string, body: unknown, token = adminToken) =>
    request.put(`/api/v1/users/${id}/whatsapp-phone`).set('Authorization', `Bearer ${token}`).send(body as object);

  it('AC1: links the number to the user, in canonical form, and reports it back', async () => {
    const res = await put(targetId, { phone: '+54 9 2622 517447' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: '542622517447' });
    const link = await linkFor('542622517447');
    expect(String(link?.userId)).toBe(targetId);
  });

  it('AC2: refuses a number already linked to another user and leaves that user without a link', async () => {
    await put(targetId, { phone: '542622517447' });

    const res = await put(otherId, { phone: '+54 9 2622 517447' });

    expect(res.status).toBe(409);
    expect(await inTenant(() => WhatsappAllowedNumber.countDocuments({ userId: new Types.ObjectId(otherId) }))).toBe(0);
  });

  it('AC3: saving a different number replaces the previous link of the same user', async () => {
    await put(targetId, { phone: '542622517447' });

    const res = await put(targetId, { phone: '542622500001' });

    expect(res.status).toBe(200);
    expect(await linkFor('542622517447')).toBeNull();
    expect(String((await linkFor('542622500001'))?.userId)).toBe(targetId);
  });

  it('AC4: clearing the number removes the link', async () => {
    await put(targetId, { phone: '542622517447' });

    const res = await put(targetId, { phone: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: null });
    expect(await linkFor('542622517447')).toBeNull();
  });

  it('rejects a number without a country code and stores nothing', async () => {
    const res = await put(targetId, { phone: '2622517447' });

    expect(res.status).toBe(400);
    expect(await inTenant(() => WhatsappAllowedNumber.countDocuments({}))).toBe(0);
  });

  it('AC6: a non-admin is refused and the link is untouched', async () => {
    await put(targetId, { phone: '542622517447' });

    const res = await put(targetId, { phone: null }, driverToken);

    expect(res.status).toBe(403);
    expect(String((await linkFor('542622517447'))?.userId)).toBe(targetId);
  });

  it('AC8: saving one user leaves a hand-made link of another user as it was', async () => {
    await inTenant(() =>
      WhatsappAllowedNumber.create({ phone: '542622599999', userId: new Types.ObjectId(otherId) })
    );

    await put(targetId, { phone: '542622517447' });

    expect(String((await linkFor('542622599999'))?.userId)).toBe(otherId);
  });

  it('T004: the user list shows each linked number, read in one batch', async () => {
    await put(targetId, { phone: '542622517447' });

    const res = await request.get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const target = res.body.find((user: { _id: string }) => user._id === targetId);
    const other = res.body.find((user: { _id: string }) => user._id === otherId);
    expect(target.whatsappPhone).toBe('542622517447');
    expect(other.whatsappPhone).toBeNull();
  });

  it('AC7: deleting a user removes that user\'s number link', async () => {
    await put(targetId, { phone: '542622517447' });

    const res = await request.delete(`/api/v1/users/${targetId}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
    expect(await linkFor('542622517447')).toBeNull();
  });
});
