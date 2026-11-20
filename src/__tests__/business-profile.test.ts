import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  indexTestUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { User } from '../modules/auth/model.js';

/**
 * Business profile (identity) — GET/PATCH /api/v1/setup/profile.
 *
 * The profile lives on the singleton BusinessConfig document and is guarded by
 * the config router's admin role + `config.manage` permission.
 */

const request = supertest(app);

const getProfile = (token: string) =>
  request.get('/api/v1/setup/profile').set('Authorization', `Bearer ${token}`);

const patchProfile = (token: string, body: Record<string, unknown>) =>
  request
    .patch('/api/v1/setup/profile')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('Business profile — /api/v1/setup/profile', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('GET returns empty defaults on a fresh tenant', async () => {
    const admin = await seedAdminUser();
    const token = await loginAs(request, admin.email, admin.password);

    const response = await getProfile(token).expect(200);

    expect(response.body).toEqual({ businessName: '', address: '', phone: '' });
  });

  it('PATCH updates all three fields and returns the stored profile', async () => {
    const admin = await seedAdminUser();
    const token = await loginAs(request, admin.email, admin.password);

    const payload = {
      businessName: 'Huevos del Sur',
      address: 'Av. Siempre Viva 742',
      phone: '+54 11 5555-1234'
    };

    const response = await patchProfile(token, payload).expect(200);
    expect(response.body).toEqual(payload);

    // Persisted and readable through a fresh GET.
    const fetched = await getProfile(token).expect(200);
    expect(fetched.body).toEqual(payload);
  });

  it('PATCH with no fields returns 400', async () => {
    const admin = await seedAdminUser();
    const token = await loginAs(request, admin.email, admin.password);

    const response = await patchProfile(token, {}).expect(400);
    expect(response.body.error).toMatch(/at least one/i);
  });

  it('PATCH with an over-long businessName returns 400', async () => {
    const admin = await seedAdminUser();
    const token = await loginAs(request, admin.email, admin.password);

    const response = await patchProfile(token, { businessName: 'x'.repeat(121) }).expect(400);
    expect(response.body).toHaveProperty('error');
  });

  it('returns 403 for a driver (role guard)', async () => {
    await seedAdminUser();
    const driver = await seedDriverUser();
    const driverToken = await loginAs(request, driver.email, driver.password);

    await getProfile(driverToken).expect(403);
    await patchProfile(driverToken, { businessName: 'Nope' }).expect(403);
  });

  it('returns 403 for an admin without config.manage', async () => {
    const passwordHash = await bcrypt.hash('limitedpassword', 10);
    const limited = await User.create({
      name: 'Limited Admin',
      email: 'limited-admin@test.com',
      passwordHash,
      role: 'admin',
      permissions: ['orders.manage']
    });
    await indexTestUser(limited.email, limited._id);

    const token = await loginAs(request, limited.email, 'limitedpassword');

    await getProfile(token).expect(403);
    await patchProfile(token, { businessName: 'Nope' }).expect(403);
  });
});
