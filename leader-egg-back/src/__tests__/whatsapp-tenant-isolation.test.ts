import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase, getTestTenantId } from './helpers.js';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { Tenant, WhatsappInstance } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { WhatsappAllowedNumber } from '../modules/whatsapp/model.js';
import { waitForIdle } from '../modules/whatsapp/queue.js';
import { chat } from '../modules/agent/service.js';

const evolution = vi.hoisted(() => ({
  sendText: vi.fn(async () => ({})),
  getBase64FromMedia: vi.fn(async () => ({}))
}));

vi.mock('../modules/agent/service.js', () => ({
  chat: vi.fn(async () => ({ reply: 'ok', toolCalls: [], actions: [] }))
}));

vi.mock('../modules/whatsapp/evolution-client.js', () => ({
  getEvolutionClient: vi.fn(() => evolution)
}));

const request = supertest(app);

const INSTANCE_NAME = 'tenant-test-isolation';
const SECRET = 'b'.repeat(40);
const WEBHOOK_PATH = `/api/v1/whatsapp/webhook/${INSTANCE_NAME}`;
/** Linked only in the OTHER tenant. */
const OTHER_TENANT_JID = '5491155550004@s.whatsapp.net';
const OTHER_TENANT_KEY = '541155550004';

const originalFlag = env.WHATSAPP_ENABLED;
const originalSecret = env.WEBHOOK_SECRET;

describe('WhatsApp: a number linked in another tenant gets nothing here', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(chat).mockClear();
    evolution.sendText.mockClear();
    env.WHATSAPP_ENABLED = true;
    env.WEBHOOK_SECRET = SECRET;

    // Instance belongs to the test tenant, which has no link for this number.
    await WhatsappInstance.create({ tenantId: getTestTenantId(), instanceName: INSTANCE_NAME });

    // Another tenant, whose database links the number to a user.
    const other = await Tenant.create({
      name: 'Otro cliente',
      slug: 'otro-cliente-test',
      dbName: 'leader_egg_otro_cliente_test',
      active: true
    });
    const connection = getTenantConnection(other.dbName);
    await runWithTenancy({ connection, tenantId: String(other._id) }, async () => {
      await WhatsappAllowedNumber.create({ phone: OTHER_TENANT_KEY, userId: new Types.ObjectId() });
    });
  });

  afterEach(() => {
    env.WHATSAPP_ENABLED = originalFlag;
    env.WEBHOOK_SECRET = originalSecret;
  });

  it('does not run a turn and does not reply', async () => {
    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send({
      event: 'messages.upsert',
      instance: INSTANCE_NAME,
      data: {
        key: { id: 'ISO-1', remoteJid: OTHER_TENANT_JID, fromMe: false },
        message: { conversation: 'dame los pedidos' }
      }
    });
    await waitForIdle();

    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).not.toHaveBeenCalled();
  });
});
