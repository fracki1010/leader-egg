import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedPuestoUser,
  loginAs,
  getTestTenantId
} from './helpers.js';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { User } from '../modules/auth/model.js';
import { PlatformAdmin } from '../tenancy/master-models.js';
import { resetLoginRateLimits } from '../modules/auth/rate-limit.js';

/**
 * Self-service password change — POST /api/v1/auth/change-password.
 *
 * Every authenticated tenant role may rotate its own password. A successful
 * change bumps `tokenVersion`, invalidating every previously issued tenant
 * token, and returns a fresh token so the current session survives. A
 * platform-forced reset uses the same invalidation mechanism.
 */

const request = supertest(app);

const PLATFORM_EMAIL = 'platform@test.com';
const PLATFORM_PASSWORD = 'platform-secret';

const changePassword = (
  token: string,
  currentPassword: string,
  newPassword: string
) =>
  request
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword, newPassword });

const getMe = (token: string) =>
  request.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

describe('Self-service password change', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    resetLoginRateLimits();
  });

  it('returns a new token, invalidates the old token and keeps the new session working', async () => {
    const admin = await seedAdminUser();
    const oldToken = await loginAs(request, admin.email, admin.password);

    const response = await changePassword(
      oldToken,
      admin.password,
      'brand-new-password'
    ).expect(200);

    const newToken = response.body.token as string;
    expect(typeof newToken).toBe('string');
    expect(newToken).not.toBe(oldToken);

    // The token used to make the change is now stale.
    await getMe(oldToken).expect(401);
    // The freshly issued token still authenticates.
    await getMe(newToken).expect(200);

    // Credentials really changed.
    await request
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'brand-new-password' })
      .expect(200);
    await request
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(401);
  });

  it('rejects a wrong current password with 400 and leaves the hash untouched', async () => {
    const admin = await seedAdminUser();
    const before = await User.findOne({ email: admin.email });
    const token = await loginAs(request, admin.email, admin.password);

    const response = await changePassword(token, 'wrong-current', 'brand-new-password').expect(400);
    expect(response.body.error).toMatch(/current password/i);

    const after = await User.findOne({ email: admin.email });
    expect(after!.passwordHash).toBe(before!.passwordHash);

    // The original session is still valid — no rotation happened.
    await getMe(token).expect(200);
  });

  it('rejects a new password shorter than 8 characters with 400', async () => {
    const admin = await seedAdminUser();
    const token = await loginAs(request, admin.email, admin.password);

    const response = await changePassword(token, admin.password, 'short').expect(400);
    expect(response.body.error).toMatch(/8/i);
  });

  it('rejects reusing the current password with 400', async () => {
    const admin = await seedAdminUser();
    const token = await loginAs(request, admin.email, admin.password);

    const response = await changePassword(token, admin.password, admin.password).expect(400);
    expect(response.body.error).toMatch(/different/i);
  });

  it('lets a driver change their own password (no role restriction)', async () => {
    await seedAdminUser();
    const driver = await seedDriverUser();
    const token = await loginAs(request, driver.email, driver.password);

    const response = await changePassword(token, driver.password, 'driver-new-secret').expect(200);
    expect(typeof response.body.token).toBe('string');

    await getMe(response.body.token as string).expect(200);
    await getMe(token).expect(401);
  });

  it('lets a puesto change their own password (no role restriction)', async () => {
    await seedAdminUser();
    const puesto = await seedPuestoUser();
    const token = await loginAs(request, puesto.email, puesto.password);

    const response = await changePassword(token, puesto.password, 'puesto-new-secret').expect(200);
    expect(typeof response.body.token).toBe('string');

    await getMe(response.body.token as string).expect(200);
    await getMe(token).expect(401);
  });

  it('invalidates a tenant user token after a platform-forced password reset', async () => {
    const admin = await seedAdminUser();
    const oldToken = await loginAs(request, admin.email, admin.password);

    const passwordHash = await bcrypt.hash(PLATFORM_PASSWORD, 10);
    await PlatformAdmin.create({
      name: 'Platform Admin',
      email: PLATFORM_EMAIL,
      passwordHash
    });
    const platformLogin = await request
      .post('/api/v1/platform/auth/login')
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
      .expect(200);
    const platformToken = platformLogin.body.token as string;

    const user = await User.findOne({ email: admin.email });

    await request
      .post(`/api/v1/platform/users/${user!._id.toString()}/reset-password`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: getTestTenantId(), newPassword: 'forced-new-secret' })
      .expect(204);

    // The tenant session issued before the reset is dead.
    await getMe(oldToken).expect(401);

    // The new password works for a fresh login.
    await request
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'forced-new-secret' })
      .expect(200);
  });

  it('keeps a legacy token without tv valid for an unmodified user', async () => {
    const admin = await seedAdminUser();
    const user = await User.findOne({ email: admin.email });

    const legacyToken = jwt.sign(
      {
        userId: user!._id.toString(),
        role: 'admin',
        tenantId: getTestTenantId(),
        jti: randomUUID()
      },
      env.JWT_SECRET,
      { audience: 'tenant', expiresIn: '1h' }
    );

    await getMe(legacyToken).expect(200);
  });
});
