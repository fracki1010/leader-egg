import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { PlatformAdmin } from '../../../tenancy/master-models.js';
import { resetLoginRateLimits } from '../../auth/rate-limit.js';

/**
 * Platform admin self-service password change.
 *
 * `PATCH /v1/platform/me/password` verifies the current password before
 * writing the new hash, so a wrong current password must leave the stored hash
 * untouched. `GET /v1/platform/me` exposes the authenticated admin for the UI.
 */

const request = supertest(app);

const EMAIL = 'platform@test.com';
const CURRENT_PASSWORD = 'current-secret';
const NEW_PASSWORD = 'new-secret-123';

const seedPlatformAdmin = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash(CURRENT_PASSWORD, 10);
  await PlatformAdmin.create({ name: 'Platform Admin', email: EMAIL, passwordHash });
};

const login = (password: string) =>
  request.post('/api/v1/platform/auth/login').send({ email: EMAIL, password });

const loginToken = async (): Promise<string> => {
  const response = await login(CURRENT_PASSWORD).expect(200);
  return response.body.token as string;
};

const changePassword = (token: string, currentPassword: string, newPassword: string) =>
  request
    .patch('/api/v1/platform/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword, newPassword });

describe('Platform admin password change', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    resetLoginRateLimits();
    await seedPlatformAdmin();
  });

  describe('GET /api/v1/platform/me', () => {
    it('returns the authenticated admin without the password hash', async () => {
      const token = await loginToken();

      const response = await request
        .get('/api/v1/platform/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.admin).toMatchObject({ name: 'Platform Admin', email: EMAIL });
      expect(response.body.admin.id).toBeDefined();
      expect(response.body.admin.passwordHash).toBeUndefined();
    });

    it('rejects requests without a platform token', async () => {
      await request.get('/api/v1/platform/me').expect(401);
    });
  });

  describe('PATCH /api/v1/platform/me/password', () => {
    it('rejects a wrong current password (400) and leaves the hash unchanged', async () => {
      const before = await PlatformAdmin.findOne({ email: EMAIL });
      const token = await loginToken();

      const response = await changePassword(token, 'wrong-current', NEW_PASSWORD).expect(400);
      expect(response.body.error).toMatch(/actual/i);

      const after = await PlatformAdmin.findOne({ email: EMAIL });
      expect(after!.passwordHash).toBe(before!.passwordHash);

      // The old password still works; the attempted new one does not.
      await login(CURRENT_PASSWORD).expect(200);
      await login(NEW_PASSWORD).expect(401);
    });

    it('changes the password: new one logs in, the old one fails', async () => {
      const token = await loginToken();

      await changePassword(token, CURRENT_PASSWORD, NEW_PASSWORD).expect(204);

      await login(NEW_PASSWORD).expect(200);
      await login(CURRENT_PASSWORD).expect(401);
    });

    it('enforces the 8-character minimum on the new password (400)', async () => {
      const token = await loginToken();

      const response = await changePassword(token, CURRENT_PASSWORD, 'short').expect(400);
      expect(response.body.error).toMatch(/8/i);
    });

    it('requires authentication', async () => {
      await request
        .patch('/api/v1/platform/me/password')
        .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });
  });
});
