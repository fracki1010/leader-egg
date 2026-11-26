import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
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
import { DEFAULT_PERMISSIONS_BY_ROLE } from '../modules/auth/permissions.js';
import { app } from '../app.js';
import { Tenant, WhatsappInstance } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { User } from '../modules/auth/model.js';
import { getEvolutionClient, MESSAGES } from '../modules/whatsapp/evolution-client.js';
import { AppError } from '../middleware/error-handler.js';
import { env } from '../config/env.js';

vi.mock('../modules/whatsapp/evolution-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/whatsapp/evolution-client.js')>()),
  getEvolutionClient: vi.fn()
}));
vi.mock('../config/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config/env.js')>();
  return {
    ...original,
    env: {
      ...original.env,
      WHATSAPP_ENABLED: true,
      WEBHOOK_SECRET: 'x'.repeat(32),
      WHATSAPP_WEBHOOK_BASE_URL: 'https://api.example.test'
    }
  };
});

const request = supertest(app);
const QR = 'data:image/png;base64,QR1';

const evolution = {
  createInstance: vi.fn(async () => ({})),
  connectInstance: vi.fn(async () => ({ base64: QR })),
  // Default: the instance does not exist yet, so the connect creates it.
  connectionState: vi.fn(async (): Promise<Record<string, unknown>> => {
    throw new AppError(MESSAGES.notFound, 404);
  }),
  deleteInstance: vi.fn(async () => ({})),
  restartInstance: vi.fn(async () => ({})),
  logoutInstance: vi.fn(),
  sendText: vi.fn(),
  getBase64FromMedia: vi.fn()
};

describe('whatsapp instance settings', () => {
  let adminToken: string;
  let driverToken: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await WhatsappInstance.deleteMany({});
    vi.clearAllMocks();
    vi.mocked(getEvolutionClient).mockReturnValue(evolution as unknown as ReturnType<typeof getEvolutionClient>);

    const admin = await seedAdminUser();
    adminToken = await loginAs(request, admin.email, admin.password);
    const driver = await seedDriverUser();
    driverToken = await loginAs(request, driver.email, driver.password);
  });

  it('reports not_created before any connection', async () => {
    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'not_created', qrCode: null });
  });

  it('creates the tenant instance with its webhook and returns the QR', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const instanceName = `tenant-${tenant!.slug}`;

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'created', qrCode: QR });
    expect((await WhatsappInstance.findOne({}))?.leaseUntil).toBeNull();
    expect(evolution.createInstance).toHaveBeenCalledWith({
      instanceName,
      webhookUrl: `https://api.example.test/api/v1/whatsapp/webhook/${instanceName}`,
      webhookSecret: 'x'.repeat(32)
    });
    expect(await WhatsappInstance.countDocuments({ tenantId: tenant!._id, instanceName })).toBe(1);
  });

  it('does not create a second instance when connecting again', async () => {
    await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);
    await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
    expect(evolution.connectInstance).toHaveBeenCalledTimes(2);
  });

  it('keeps the record unconfirmed and frees its lease when Evolution refuses, so a retry creates it', async () => {
    evolution.createInstance.mockRejectedValueOnce(new Error('provider down'));

    const first = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);
    expect(first.status).toBe(500);
    const record = await WhatsappInstance.findOne({});
    expect(record?.providerCreated).toBe(false);
    expect(record?.leaseUntil).toBeNull();

    const second = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);
    expect(second.status).toBe(200);
    expect(evolution.createInstance).toHaveBeenCalledTimes(2);
  });

  it('creates the instance on the next connect when a crash left the claim without it', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({ tenantId: tenant!._id, instanceName: `tenant-${tenant!.slug}`, providerCreated: false });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
    expect((await WhatsappInstance.findOne({ tenantId: tenant!._id }))?.providerCreated).toBe(true);
  });

  it('adopts an instance Evolution already has, without creating it', async () => {
    evolution.connectionState.mockResolvedValueOnce({ instance: { state: 'connecting' } });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.connectionState).toHaveBeenCalledWith(`tenant-${(await Tenant.findById(getTestTenantId()))!.slug}`);
    expect(evolution.createInstance).not.toHaveBeenCalled();
    expect((await WhatsappInstance.findOne({}))?.providerCreated).toBe(true);
  });

  it('never creates blind when the probe fails with an unexpected error', async () => {
    evolution.connectionState.mockRejectedValueOnce(new Error('boom'));

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });

  it('never creates blind when the probe is refused with a status other than 404', async () => {
    evolution.connectionState.mockRejectedValueOnce(new AppError('bad key', 401));

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(401);
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });

  it('fails closed when the probe cannot reach the provider, without creating', async () => {
    evolution.connectionState.mockRejectedValueOnce(new AppError(MESSAGES.unreachable, 503));

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(503);
    expect(evolution.createInstance).not.toHaveBeenCalled();
    const record = await WhatsappInstance.findOne({});
    expect(record?.providerCreated).toBe(false);
    expect(record?.leaseUntil).toBeNull();
  });

  it('does not free a newer lease when its own create fails', async () => {
    const future = new Date(Date.now() + 60_000);
    evolution.createInstance.mockImplementationOnce(async () => {
      // Another connect takes a newer lease while this create is still running.
      await WhatsappInstance.updateOne({}, { $set: { leaseUntil: future } });
      throw new Error('timeout');
    });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(500);
    expect((await WhatsappInstance.findOne({}))?.leaseUntil?.getTime()).toBe(future.getTime());
  });

  it('takes over an expired lease left by a crash', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: false,
      leaseUntil: new Date(Date.now() - 1000)
    });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
  });

  it('backs off with 409 while another connect holds a live lease', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: false,
      leaseUntil: new Date(Date.now() + 60_000)
    });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });

  it('creates the instance once when two connects arrive together', async () => {
    evolution.createInstance.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {};
    });

    const [a, b] = await Promise.all([
      request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`),
      request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`)
    ]);

    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
    expect(await WhatsappInstance.countDocuments({})).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('removes the instance it created when its business was deleted meanwhile', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    evolution.createInstance.mockImplementationOnce(async () => {
      // The business is deleted while its line is being created.
      await WhatsappInstance.deleteMany({});
      return {};
    });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(evolution.deleteInstance).toHaveBeenCalledWith(`tenant-${tenant!.slug}`);
    expect(evolution.connectInstance).not.toHaveBeenCalled();
    expect(await WhatsappInstance.countDocuments({})).toBe(0);
  });

  it('hides the QR once the line is open, even when the QR is newer than the state change', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const now = Date.now();
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      state: 'open',
      stateUpdatedAt: new Date(now - 60_000),
      qrCode: QR,
      qrUpdatedAt: new Date(now)
    });

    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ state: 'open', qrCode: null });
  });

  it('drops a QR issued before the line disconnected, so the admin can ask for a new one', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const now = Date.now();
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'close',
      stateUpdatedAt: new Date(now),
      qrCode: QR,
      qrUpdatedAt: new Date(now - 60_000)
    });

    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ state: 'close', qrCode: null });
  });

  it('keeps the QR while waiting for a scan, even if the state changed after it was issued', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const now = Date.now();
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'connecting',
      stateUpdatedAt: new Date(now),
      qrCode: QR,
      qrUpdatedAt: new Date(now - 1000)
    });

    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ state: 'connecting', qrCode: QR });
  });

  it('shows a QR issued after the line disconnected, so a reconnect can be scanned', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const now = Date.now();
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'close',
      stateUpdatedAt: new Date(now - 60_000),
      qrCode: QR,
      qrUpdatedAt: new Date(now)
    });

    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ state: 'close', qrCode: QR });
  });

  it('keeps the connected line when the business admin is replaced', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'open'
    });
    const replacement = 'replacement@test.com';
    const passwordHash = await bcrypt.hash('testpassword', 10);
    const newAdmin = await User.create({
      name: 'Replacement Admin',
      email: replacement,
      passwordHash,
      role: 'admin',
      permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.admin]
    });
    await indexTestUser(replacement, newAdmin._id);
    await User.deleteOne({ email: 'admin@test.com' });

    const token = await loginAs(request, replacement, 'testpassword');
    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'open', qrCode: null });
    expect(await WhatsappInstance.countDocuments({ tenantId: tenant!._id })).toBe(1);
  });

  it('refuses an admin who lacks config.manage', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    await runWithTenancy({ connection, tenantId: String(tenant!._id) }, () =>
      User.updateOne({ email: 'admin@test.com' }, { $set: { permissions: [] } })
    );
    const token = await loginAs(request, 'admin@test.com', 'testpassword');

    const get = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${token}`);
    const connect = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${token}`);

    expect(get.status).toBe(403);
    expect(connect.status).toBe(403);
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });

  it('refuses a user who is not an admin', async () => {
    const get = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${driverToken}`);
    const connect = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${driverToken}`);

    expect(get.status).toBe(403);
    expect(connect.status).toBe(403);
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });

  it('restarts a stuck connecting line when Evolution answers without a QR, then returns the new QR', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'connecting'
    });
    // Evolution answers without a QR: the reply carries no base64.
    evolution.connectInstance.mockResolvedValueOnce({} as { base64: string });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.restartInstance).toHaveBeenCalledWith(`tenant-${tenant!.slug}`);
    expect(res.body).toEqual({ state: 'connecting', qrCode: QR });
  });

  it('does not restart a line that turned open while the connect was in flight', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const instanceName = `tenant-${tenant!.slug}`;
    await WhatsappInstance.create({ tenantId: tenant!._id, instanceName, providerCreated: true, state: 'connecting' });
    // The webhook reports open while Evolution answers without a QR.
    evolution.connectInstance.mockImplementationOnce(async () => {
      await WhatsappInstance.updateOne({ instanceName }, { $set: { state: 'open' } });
      return {} as { base64: string };
    });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.restartInstance).not.toHaveBeenCalled();
  });

  it('restarts at most once when Evolution keeps answering without a QR', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'connecting'
    });
    evolution.connectInstance
      .mockResolvedValueOnce({} as { base64: string })
      .mockResolvedValueOnce({} as { base64: string });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.restartInstance).toHaveBeenCalledTimes(1);
    expect(evolution.connectInstance).toHaveBeenCalledTimes(2);
  });

  it('never restarts a line that already gets a QR from Evolution', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'connecting'
    });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.qrCode).toBe(QR);
    expect(evolution.restartInstance).not.toHaveBeenCalled();
  });

  it('never restarts an open line, even when Evolution answers without a QR', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      providerCreated: true,
      state: 'open'
    });
    // Evolution answers without a QR: the reply carries no base64.
    evolution.connectInstance.mockResolvedValueOnce({} as { base64: string });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.restartInstance).not.toHaveBeenCalled();
  });

  it('refuses to create a line while the WhatsApp feature is switched off', async () => {
    env.WHATSAPP_ENABLED = false;
    try {
      const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(503);
      expect(evolution.createInstance).not.toHaveBeenCalled();
    } finally {
      env.WHATSAPP_ENABLED = true;
    }
  });

  it('reads only its own tenant line, never another business line', async () => {
    const other = await Tenant.create({ name: 'Otro negocio', slug: 'otro-negocio', dbName: 'tenant_otro-negocio', active: true });
    await WhatsappInstance.create({ tenantId: other._id, instanceName: 'tenant-otro-negocio', providerCreated: true, state: 'open' });

    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ state: 'not_created', qrCode: null });
  });

  it('passes the fixed provider credentials message through unchanged', async () => {
    evolution.connectionState.mockRejectedValueOnce(new AppError(MESSAGES.unauthorized, 503));

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toContain(MESSAGES.unauthorized);
  });

  it('connects its own business without adopting another business line', async () => {
    const other = await Tenant.create({ name: 'Otro negocio 2', slug: 'otro-negocio-2', dbName: 'tenant_otro-negocio-2', active: true });
    await WhatsappInstance.create({ tenantId: other._id, instanceName: 'tenant-otro-negocio-2', providerCreated: true, state: 'open', qrCode: QR });

    const res = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(evolution.createInstance).toHaveBeenCalledTimes(1);
    expect(await WhatsappInstance.findOne({ tenantId: other._id })).toMatchObject({ state: 'open', qrCode: QR });
  });
});
