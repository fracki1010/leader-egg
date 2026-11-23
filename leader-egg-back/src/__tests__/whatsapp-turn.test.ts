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
import { Tenant, WhatsappInstance } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { User } from '../modules/auth/model.js';
import { WhatsappAllowedNumber } from '../modules/whatsapp/model.js';
import { waitForIdle } from '../modules/whatsapp/queue.js';
import { chat } from '../modules/agent/service.js';
import { AgentPendingAction } from '../modules/agent/model.js';
import { confirmAction } from '../modules/agent/actions.js';
import { Types } from 'mongoose';

const sendText = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../modules/agent/service.js', () => ({
  chat: vi.fn(async () => ({ reply: 'Hay 3 pedidos hoy.', toolCalls: [], actions: [] }))
}));

vi.mock('../modules/agent/actions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/agent/actions.js')>()),
  confirmAction: vi.fn(async () => ({ resultSummary: 'Pago registrado.' }))
}));

vi.mock('../modules/whatsapp/evolution-client.js', () => ({
  getEvolutionClient: vi.fn(() => ({ sendText }))
}));

const request = supertest(app);

const INSTANCE_NAME = 'tenant-test-turn';
const SECRET = 'z'.repeat(40);
const WEBHOOK_PATH = `/api/v1/whatsapp/webhook/${INSTANCE_NAME}`;
const LINKED_JID = '5491155550002@s.whatsapp.net';
const LINKED_KEY = '541155550002';
const UNLINKED_JID = '5491155550998@s.whatsapp.net';

const originalFlag = env.WHATSAPP_ENABLED;
const originalSecret = env.WEBHOOK_SECRET;

const textUpsert = (remoteJid: string, text: string, id: string) => ({
  event: 'messages.upsert',
  instance: INSTANCE_NAME,
  data: { key: { id, remoteJid, fromMe: false }, message: { conversation: text } }
});

describe('WhatsApp turn: text in, reply out', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(chat).mockClear();
    sendText.mockClear();
    env.WHATSAPP_ENABLED = true;
    env.WEBHOOK_SECRET = SECRET;

    await WhatsappInstance.create({ tenantId: getTestTenantId(), instanceName: INSTANCE_NAME });

    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    await runWithTenancy({ connection, tenantId: String(tenant!._id) }, async () => {
      const user = await User.create({
        name: 'Equipo',
        email: 'equipo@test.com',
        passwordHash: 'x',
        role: 'admin',
        permissions: ['orders.manage']
      });
      await WhatsappAllowedNumber.create({ phone: LINKED_KEY, userId: user._id });
    });
  });

  afterEach(() => {
    env.WHATSAPP_ENABLED = originalFlag;
    env.WEBHOOK_SECRET = originalSecret;
  });

  it('sends the agent reply back to the same chat', async () => {
    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send(textUpsert(LINKED_JID, 'cuántos pedidos hay hoy', 'MSG-REPLY'));
    await waitForIdle();

    expect(chat).toHaveBeenCalledWith(
      expect.any(String),
      'Equipo',
      ['orders.manage'],
      'cuántos pedidos hay hoy'
    );
    expect(sendText).toHaveBeenCalledWith(INSTANCE_NAME, {
      number: LINKED_JID,
      text: 'Hay 3 pedidos hoy.'
    });
  });

  it('confirms the pending action when the user types "sí", without the agent', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    const action = await runWithTenancy({ connection, tenantId: String(tenant!._id) }, async () => {
      const user = await User.findOne({ email: 'equipo@test.com' });
      return AgentPendingAction.create({
        userId: user!._id,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'register_payment',
        payload: {},
        preview: 'Cobro de $100',
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      });
    });

    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send(textUpsert(LINKED_JID, 'sí', 'MSG-YES'));
    await waitForIdle();

    expect(confirmAction).toHaveBeenCalledWith(expect.any(String), 'admin', ['orders.manage'], String(action._id));
    expect(chat).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(INSTANCE_NAME, { number: LINKED_JID, text: 'Pago registrado.' });
  });

  it('tells the user when the agent fails, and writes nothing', async () => {
    vi.mocked(chat).mockRejectedValueOnce(new Error('provider down'));

    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send(textUpsert(LINKED_JID, 'hola', 'MSG-FAIL'));
    await waitForIdle();

    expect(sendText).toHaveBeenCalledWith(INSTANCE_NAME, {
      number: LINKED_JID,
      text: 'No pude procesar tu mensaje. Intentalo de nuevo en un momento.'
    });
  });

  it('answers an image with the fixed reply, without the agent', async () => {
    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send({
      event: 'messages.upsert',
      instance: INSTANCE_NAME,
      data: { key: { id: 'IMG-1', remoteJid: LINKED_JID, fromMe: false }, message: { imageMessage: {} } }
    });
    await waitForIdle();

    expect(chat).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(INSTANCE_NAME, {
      number: LINKED_JID,
      text: 'Por ahora no puedo leer imágenes. Escribime lo que necesitás.'
    });
  });

  it('passes a shared location to the agent with its coordinates', async () => {
    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send({
      event: 'messages.upsert',
      instance: INSTANCE_NAME,
      data: {
        key: { id: 'LOC-1', remoteJid: LINKED_JID, fromMe: false },
        message: { locationMessage: { degreesLatitude: -34.6, degreesLongitude: -58.4 } }
      }
    });
    await waitForIdle();

    expect(chat).toHaveBeenCalledWith(
      expect.any(String),
      'Equipo',
      ['orders.manage'],
      expect.stringContaining('lat -34.6, lng -58.4')
    );
    expect(sendText).toHaveBeenCalledWith(INSTANCE_NAME, expect.objectContaining({ number: LINKED_JID }));
  });

  it('answers a redelivered message only once', async () => {
    const upsert = textUpsert(LINKED_JID, 'cuántos pedidos hay hoy', 'MSG-DUP');
    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(upsert);
    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(upsert);
    await waitForIdle();

    expect(chat).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a number that is not linked', async () => {
    await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send(textUpsert(UNLINKED_JID, 'hola', 'MSG-SILENT'));
    await waitForIdle();

    expect(chat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
