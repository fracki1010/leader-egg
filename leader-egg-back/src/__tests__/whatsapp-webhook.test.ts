import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  getTestTenantId
} from './helpers.js';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { WhatsappInstance } from '../tenancy/master-models.js';
import { runWhatsappTurn } from '../modules/whatsapp/turn.js';

/** The turn is replaced by a spy: the webhook suite never reaches the agent. */
vi.mock('../modules/whatsapp/turn.js', () => ({
  runWhatsappTurn: vi.fn(async () => undefined)
}));

const request = supertest(app);

const INSTANCE_NAME = 'tenant-test-tenant';
const SECRET = 'x'.repeat(40);
const WEBHOOK_PATH = `/api/v1/whatsapp/webhook/${INSTANCE_NAME}`;

const originalFlag = env.WHATSAPP_ENABLED;
const originalSecret = env.WEBHOOK_SECRET;

describe('WhatsApp webhook: authentication, routing and status events', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(runWhatsappTurn).mockClear();

    env.WHATSAPP_ENABLED = true;
    env.WEBHOOK_SECRET = SECRET;

    await WhatsappInstance.create({ tenantId: getTestTenantId(), instanceName: INSTANCE_NAME });
  });

  afterEach(() => {
    env.WHATSAPP_ENABLED = originalFlag;
    env.WEBHOOK_SECRET = originalSecret;
  });

  it('answers 404 when the feature flag is off, even with a valid secret', async () => {
    env.WHATSAPP_ENABLED = false;

    const response = await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send({ event: 'connection.update', data: { state: 'open' } });

    expect(response.status).toBe(404);
    expect((await WhatsappInstance.findOne({ instanceName: INSTANCE_NAME }))?.state).toBe('created');
  });

  it('answers 404 for an instance name the master DB does not know', async () => {
    const response = await request
      .post('/api/v1/whatsapp/webhook/tenant-unknown')
      .set('x-webhook-secret', SECRET)
      .send({ event: 'connection.update', data: { state: 'open' } });

    expect(response.status).toBe(404);
  });

  it('answers 401 for a wrong or missing secret and changes nothing', async () => {
    const wrong = await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', 'y'.repeat(40))
      .send({ event: 'connection.update', data: { state: 'open' } });

    const missing = await request
      .post(WEBHOOK_PATH)
      .send({ event: 'connection.update', data: { state: 'open' } });

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect((await WhatsappInstance.findOne({ instanceName: INSTANCE_NAME }))?.state).toBe('created');
    expect(runWhatsappTurn).not.toHaveBeenCalled();
  });

  it('stores CONNECTION_UPDATE on the master routing record and acknowledges with 200', async () => {
    const response = await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send({ event: 'connection.update', instance: INSTANCE_NAME, data: { state: 'open' } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });

    const instance = await WhatsappInstance.findOne({ instanceName: INSTANCE_NAME });
    expect(instance?.state).toBe('open');
    expect(instance?.lastEventAt).toBeInstanceOf(Date);
  });

  it('keeps stateUpdatedAt when Evolution repeats the same state', async () => {
    const before = new Date(Date.now() - 60_000);
    await WhatsappInstance.updateOne({ instanceName: INSTANCE_NAME }, { $set: { state: 'connecting', stateUpdatedAt: before } });

    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send({ event: 'connection.update', instance: INSTANCE_NAME, data: { state: 'connecting' } });

    const instance = await WhatsappInstance.findOne({ instanceName: INSTANCE_NAME });
    expect(instance?.stateUpdatedAt.getTime()).toBe(before.getTime());
  });

  it('stores QRCODE_UPDATED and clears it once the connection is open', async () => {
    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send({
        event: 'qrcode.updated',
        data: { qrcode: { base64: 'data:image/png;base64,AAAA' } }
      });

    const pending = await WhatsappInstance.findOne({ instanceName: INSTANCE_NAME });
    expect(pending?.qrCode).toBe('data:image/png;base64,AAAA');
    expect(pending?.qrUpdatedAt).toBeInstanceOf(Date);

    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send({ event: 'connection.update', data: { state: 'open' } });

    const connected = await WhatsappInstance.findOne({ instanceName: INSTANCE_NAME });
    expect(connected?.qrCode).toBeNull();
  });
});
