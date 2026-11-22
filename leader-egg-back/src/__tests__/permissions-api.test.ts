import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import {
  clearDatabase,
  loginAs,
  seedAdminUser,
  seedDriverUser,
  startTestDatabase,
  stopTestDatabase
} from './helpers.js';
import { app } from '../app.js';
import { User } from '../modules/auth/model.js';
import { ALL_PERMISSIONS } from '../modules/auth/permissions.js';

const request = supertest(app);

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const registerUser = async (
  token: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const response = await request
    .post('/api/v1/auth/register')
    .set(bearer(token))
    .send(payload)
    .expect(201);
  return response.body.user as Record<string, unknown>;
};

describe('permissions middleware + users API', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('reloads permissions on every request with the same token', async () => {
    const { email, password } = await seedAdminUser();
    const token = await loginAs(request, email, password);

    await request.get('/api/v1/customers').set(bearer(token)).expect(200);

    // Permission changes apply immediately, even though the JWT is unchanged.
    await User.updateOne({ email }, { $set: { permissions: [] } });
    await request.get('/api/v1/customers').set(bearer(token)).expect(403);

    await User.updateOne({ email }, { $set: { permissions: ['customers.view'] } });
    await request.get('/api/v1/customers').set(bearer(token)).expect(200);
  });

  it('reloads the role on every request with the same token', async () => {
    const { email, password } = await seedAdminUser();
    const token = await loginAs(request, email, password);

    await request.get('/api/v1/users').set(bearer(token)).expect(200);

    // Demote in the DB only; the stale token still claims `admin`.
    await User.updateOne({ email }, { $set: { role: 'driver', permissions: [] } });
    await request.get('/api/v1/users').set(bearer(token)).expect(403);
  });

  it('gives a newly-created admin the full permission set by default', async () => {
    const { email, password } = await seedAdminUser();
    const token = await loginAs(request, email, password);

    const created = await registerUser(token, {
      name: 'Second Admin',
      email: 'admin2@test.com',
      password: 'secret123',
      role: 'admin'
    });

    expect(created.permissions).toEqual(ALL_PERMISSIONS);

    const stored = await User.findOne({ email: 'admin2@test.com' });
    expect(stored!.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('ignores permissions supplied for non-admin roles', async () => {
    const { email, password } = await seedAdminUser();
    const token = await loginAs(request, email, password);

    const created = await registerUser(token, {
      name: 'Driver With Perms',
      email: 'permdriver@test.com',
      password: 'secret123',
      role: 'driver',
      permissions: ['orders.manage']
    });

    expect(created.permissions).toEqual([]);

    const stored = await User.findOne({ email: 'permdriver@test.com' });
    expect(stored!.permissions).toEqual([]);
  });

  it('PATCH permissions changes what the target admin can use', async () => {
    const { email, password } = await seedAdminUser();
    const token = await loginAs(request, email, password);

    await registerUser(token, {
      name: 'Limited Admin',
      email: 'limited@test.com',
      password: 'secret123',
      role: 'admin'
    });
    const limited = await User.findOne({ email: 'limited@test.com' });

    const patched = await request
      .patch(`/api/v1/users/${limited!._id.toString()}`)
      .set(bearer(token))
      .send({ permissions: ['orders.view'] })
      .expect(200);

    expect(patched.body.user.permissions).toEqual(['orders.view']);

    const limitedToken = await loginAs(request, 'limited@test.com', 'secret123');
    await request.get('/api/v1/orders').set(bearer(limitedToken)).expect(200);
    await request.get('/api/v1/customers').set(bearer(limitedToken)).expect(403);
  });

  it('refuses to remove users.manage from the last admin (409)', async () => {
    const { email, password } = await seedAdminUser();
    const token = await loginAs(request, email, password);
    const admin = await User.findOne({ email });

    const response = await request
      .patch(`/api/v1/users/${admin!._id.toString()}`)
      .set(bearer(token))
      .send({ permissions: ['orders.view'] })
      .expect(409);

    expect(response.body.error).toMatch(/user management/i);

    const unchanged = await User.findById(admin!._id);
    expect(unchanged!.permissions).toContain('users.manage');
  });

  it('lets non-admin roles bypass module permissions on an admin+driver route', async () => {
    await seedAdminUser();
    const { email, password } = await seedDriverUser();
    const driverToken = await loginAs(request, email, password);

    await request.get('/api/v1/dashboard/summary').set(bearer(driverToken)).expect(200);
  });
});
