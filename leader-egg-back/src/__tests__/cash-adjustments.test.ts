import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import mongoose from 'mongoose';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { User } from '../modules/auth/model.js';
import { CashAdjustment } from '../modules/cash-adjustments/model.js';
import { provisionTenant } from '../tenancy/tenants.js';

const request = supertest(app);

/** Drops every `tenant_*` database created by provisioning (test cleanup). */
const dropTenantDatabases = async (): Promise<void> => {
  const admin = mongoose.connection.db!.admin();
  const { databases } = await admin.listDatabases();
  for (const db of databases) {
    if (db.name?.startsWith('tenant_')) {
      await mongoose.connection.useDb(db.name).dropDatabase();
    }
  }
};

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

describe('Cash adjustments — /api/v1/cash-adjustments', () => {
  let adminToken: string;
  let driverToken: string;
  let adminId: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await dropTenantDatabases();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    const admin = await seedAdminUser();
    const driver = await seedDriverUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
    const adminUser = await User.findOne({ email: admin.email });
    adminId = String(adminUser!._id);
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  describe('POST /', () => {
    it('creates a positive cash adjustment', async () => {
      const res = await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 500, reason: 'found', note: 'Sobrante en caja' })
        .expect(201);

      expect(res.body.amount).toBe(500);
      expect(res.body.account).toBe('cash');
      expect(res.body.reason).toBe('found');
      expect(res.body.note).toBe('Sobrante en caja');
      expect(res.body.channel).toBe('reparto');
      expect(res.body.createdBy).toBe(adminId);
      expect(res.body._id).toBeDefined();
    });

    it('creates a negative adjustment (removes money)', async () => {
      const res = await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'mp', amount: -200, reason: 'missing' })
        .expect(201);

      expect(res.body.amount).toBe(-200);
      expect(res.body.account).toBe('mp');
    });

    it('accepts a channel override', async () => {
      const res = await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 50, reason: 'correction', channel: 'puesto' })
        .expect(201);

      expect(res.body.channel).toBe('puesto');
    });

    it('rejects a zero amount', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 0, reason: 'other' })
        .expect(400);
    });

    it('rejects an invalid account', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'wallet', amount: 10, reason: 'other' })
        .expect(400);
    });

    it('rejects an invalid reason', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 10, reason: 'party' })
        .expect(400);
    });

    it('rejects a note over 300 chars', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 10, reason: 'other', note: 'x'.repeat(301) })
        .expect(400);
    });

    it('returns 403 for a driver', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ account: 'cash', amount: 10, reason: 'other' })
        .expect(403);
    });

    it('returns 401 without auth', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .send({ account: 'cash', amount: 10, reason: 'other' })
        .expect(401);
    });
  });

  describe('Dashboard integration', () => {
    it('adds a +500 cash adjustment to saldos.efectivo, caja and cajaHoy', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 500, reason: 'found' })
        .expect(201);

      const res = await request.get('/api/v1/dashboard/summary').set(auth()).expect(200);

      expect(res.body.saldos.efectivo).toBe(500);
      expect(res.body.caja).toBe(500);
      // Registered today → shows in "caja de hoy".
      expect(res.body.cajaHoy).toBe(500);
    });

    it('subtracts a −200 mp adjustment from saldos.mercadopago', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'mp', amount: -200, reason: 'missing' })
        .expect(201);

      const res = await request.get('/api/v1/dashboard/summary').set(auth()).expect(200);

      expect(res.body.saldos.mercadopago).toBe(-200);
      expect(res.body.caja).toBe(-200);
      expect(res.body.cajaHoy).toBe(-200);
    });

    it('keeps other accounts untouched', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'bank', amount: 300, reason: 'correction' })
        .expect(201);

      const res = await request.get('/api/v1/dashboard/summary').set(auth()).expect(200);

      expect(res.body.saldos).toEqual({
        efectivo: 0,
        mercadopago: 0,
        banco: 300,
        total: 300
      });
    });

    it('does not count a past-dated adjustment in cajaHoy', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 500, reason: 'found', date: daysAgo(3).toISOString() })
        .expect(201);

      const res = await request.get('/api/v1/dashboard/summary').set(auth()).expect(200);

      expect(res.body.saldos.efectivo).toBe(500);
      expect(res.body.caja).toBe(500);
      expect(res.body.cajaHoy).toBe(0);
    });
  });

  describe('Append-only', () => {
    it('exposes no update or delete endpoint', async () => {
      const created = await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 100, reason: 'other' })
        .expect(201);

      await request
        .put(`/api/v1/cash-adjustments/${created.body._id}`)
        .set(auth())
        .send({ amount: 999 })
        .expect(404);
      await request
        .patch(`/api/v1/cash-adjustments/${created.body._id}`)
        .set(auth())
        .send({ amount: 999 })
        .expect(404);
      await request.delete(`/api/v1/cash-adjustments/${created.body._id}`).set(auth()).expect(404);
    });

    it('blocks updates and deletes at the model layer', async () => {
      const created = await CashAdjustment.create({
        account: 'cash',
        amount: 100,
        reason: 'other',
        createdBy: adminId
      });

      await expect(
        CashAdjustment.findByIdAndUpdate(created._id, { amount: 999 })
      ).rejects.toThrow(/append-only/);
      await expect(CashAdjustment.findByIdAndDelete(created._id)).rejects.toThrow(/append-only/);
      await expect(CashAdjustment.deleteMany({})).rejects.toThrow(/append-only/);
    });
  });

  describe('GET /', () => {
    beforeEach(async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 500, reason: 'found', date: daysAgo(10).toISOString() })
        .expect(201);
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'mp', amount: -200, reason: 'missing', date: daysAgo(5).toISOString() })
        .expect(201);
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 100, reason: 'cash_count' })
        .expect(201);
    });

    it('lists adjustments newest first with creator name and summary', async () => {
      const res = await request.get('/api/v1/cash-adjustments').set(auth()).expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.adjustments).toHaveLength(3);
      expect(res.body.adjustments[0].amount).toBe(100);
      expect(res.body.adjustments[0].createdByName).toBe('Test Admin');
      expect(res.body.summary).toEqual({ cash: 600, mp: -200, bank: 0, total: 400 });
    });

    it('filters by account', async () => {
      const res = await request
        .get('/api/v1/cash-adjustments?account=cash')
        .set(auth())
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.adjustments.every((a: { account: string }) => a.account === 'cash')).toBe(true);
    });

    it('filters by date range', async () => {
      const from = daysAgo(7).toISOString();
      const to = new Date().toISOString();
      const res = await request
        .get(`/api/v1/cash-adjustments?from=${from}&to=${to}`)
        .set(auth())
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    it('returns 400 when from > to', async () => {
      const from = new Date().toISOString();
      const to = daysAgo(7).toISOString();
      await request
        .get(`/api/v1/cash-adjustments?from=${from}&to=${to}`)
        .set(auth())
        .expect(400);
    });

    it('filters by createdBy', async () => {
      const res = await request
        .get(`/api/v1/cash-adjustments?createdBy=${adminId}`)
        .set(auth())
        .expect(200);

      expect(res.body.total).toBe(3);
    });

    it('supports pagination', async () => {
      const res = await request
        .get('/api/v1/cash-adjustments?page=1&limit=2')
        .set(auth())
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.adjustments).toHaveLength(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
    });

    it('returns 403 for a driver', async () => {
      await request
        .get('/api/v1/cash-adjustments')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('returns 401 without auth', async () => {
      await request.get('/api/v1/cash-adjustments').expect(401);
    });
  });

  describe('Tenant isolation', () => {
    it('does not leak adjustments to another tenant', async () => {
      await request
        .post('/api/v1/cash-adjustments')
        .set(auth())
        .send({ account: 'cash', amount: 777, reason: 'found' })
        .expect(201);

      const other = await provisionTenant({
        name: 'Other Co',
        slug: 'other-co',
        adminName: 'Other Admin',
        adminEmail: 'admin@other.test',
        adminPassword: 'other-secret-123'
      });

      const login = await request
        .post('/api/v1/auth/login')
        .send({ email: 'admin@other.test', password: 'other-secret-123' })
        .expect(200);

      const res = await request
        .get('/api/v1/cash-adjustments')
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.adjustments).toEqual([]);
      expect(String(other._id)).toBeDefined();
    });
  });
});
