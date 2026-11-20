import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from '../../../__tests__/helpers.js';
import { app } from '../../../app.js';
import { env } from '../../../config/env.js';
import { PlatformAdmin } from '../../../tenancy/master-models.js';
import { getPlatformJwtSecret } from '../service.js';

const request = supertest(app);

const PLATFORM_EMAIL = 'platform@test.com';
const PLATFORM_PASSWORD = 'platform-secret';

const seedPlatformAdmin = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash(PLATFORM_PASSWORD, 10);
  await PlatformAdmin.create({ name: 'Platform Admin', email: PLATFORM_EMAIL, passwordHash });
};

describe('Platform auth — /api/v1/platform/auth', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedPlatformAdmin();
  });

  describe('POST /api/v1/platform/auth/login', () => {
    it('returns a platform token for valid credentials', async () => {
      const response = await request
        .post('/api/v1/platform/auth/login')
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
        .expect(200);

      expect(typeof response.body.token).toBe('string');
      expect(response.body.admin.email).toBe(PLATFORM_EMAIL);

      const decoded = jwt.verify(response.body.token, getPlatformJwtSecret(), {
        audience: 'platform'
      }) as {
        adminId: string;
        scope: string;
      };
      expect(decoded.scope).toBe('platform');
      expect(decoded.adminId).toBe(response.body.admin.id);
    });

    it('returns 401 on a bad password', async () => {
      const response = await request
        .post('/api/v1/platform/auth/login')
        .send({ email: PLATFORM_EMAIL, password: 'wrong-password' })
        .expect(401);

      expect(response.body.error).toMatch(/invalid credentials/i);
    });

    it('returns 401 on an unknown email', async () => {
      const response = await request
        .post('/api/v1/platform/auth/login')
        .send({ email: 'nobody@test.com', password: PLATFORM_PASSWORD })
        .expect(401);

      expect(response.body.error).toMatch(/invalid credentials/i);
    });
  });

  describe('platformAuthenticate', () => {
    it('rejects a tenant token (no platform scope)', async () => {
      const tenantToken = jwt.sign(
        { userId: new Types.ObjectId().toString(), role: 'admin', tenantId: 'tenant-x', jti: randomUUID() },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      await request
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(401);
    });

    it('rejects requests without a token', async () => {
      await request.get('/api/v1/platform/tenants').expect(401);
    });

    it('accepts a valid platform token', async () => {
      const login = await request
        .post('/api/v1/platform/auth/login')
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
        .expect(200);

      await request
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(200);
    });

    it('rejects a platform token whose admin was deleted (401)', async () => {
      const login = await request
        .post('/api/v1/platform/auth/login')
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
        .expect(200);

      // The signed admin no longer exists — the token must not authenticate.
      await PlatformAdmin.deleteMany({});

      await request
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(401);
    });

    it('rejects a platform token on tenant routes (401)', async () => {
      const login = await request
        .post('/api/v1/platform/auth/login')
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
        .expect(200);

      // Platform tokens are signed for the `platform` audience with the platform
      // secret, so the tenant `authenticate` middleware rejects them.
      await request
        .get('/api/v1/products')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(401);
    });
  });
});
