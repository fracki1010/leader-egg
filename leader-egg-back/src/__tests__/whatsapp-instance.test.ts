import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  loginAs,
  getTestTenantId
} from './helpers.js';
import { app } from '../app.js';
import { Tenant, WhatsappInstance } from '../tenancy/master-models.js';
import { getEvolutionClient } from '../modules/whatsapp/evolution-client.js';

vi.mock('../modules/whatsapp/evolution-client.js', () => ({ getEvolutionClient: vi.fn() }));
vi.mock('../config/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config/env.js')>();
  return {
    ...original,
    env: {
      ...original.env,
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
  connectionState: vi.fn(),
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

  it('hides the QR once the line is open', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    await WhatsappInstance.create({
      tenantId: tenant!._id,
      instanceName: `tenant-${tenant!.slug}`,
      state: 'open',
      qrCode: QR,
      qrUpdatedAt: new Date()
    });

    const res = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ state: 'open', qrCode: null });
  });

  it('refuses a user who is not an admin', async () => {
    const get = await request.get('/api/v1/whatsapp/instance').set('Authorization', `Bearer ${driverToken}`);
    const connect = await request.post('/api/v1/whatsapp/instance/connect').set('Authorization', `Bearer ${driverToken}`);

    expect(get.status).toBe(403);
    expect(connect.status).toBe(403);
    expect(evolution.createInstance).not.toHaveBeenCalled();
  });
});
