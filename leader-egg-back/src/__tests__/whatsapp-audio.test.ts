import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { startTestDatabase, stopTestDatabase, clearDatabase, getTestTenantId } from './helpers.js';
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
import { MAX_AUDIO_BYTES } from '../modules/whatsapp/media.js';
import { confirmAction } from '../modules/agent/actions.js';
import { Types } from 'mongoose';

const evolution = vi.hoisted(() => ({
  sendText: vi.fn(async () => ({})),
  getBase64FromMedia: vi.fn(async () => ({ base64: 'T1BVU0VS', mimetype: 'audio/ogg' }))
}));

vi.mock('../modules/agent/service.js', () => ({
  chat: vi.fn(async () => ({ reply: 'Hay 3 pedidos hoy.', toolCalls: [], actions: [] }))
}));

vi.mock('../modules/agent/actions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/agent/actions.js')>()),
  confirmAction: vi.fn(async () => ({ resultSummary: 'Pago registrado.' }))
}));

vi.mock('../modules/whatsapp/evolution-client.js', () => ({
  getEvolutionClient: vi.fn(() => evolution)
}));

const request = supertest(app);

const INSTANCE_NAME = 'tenant-test-audio';
const SECRET = 'a'.repeat(40);
const WEBHOOK_PATH = `/api/v1/whatsapp/webhook/${INSTANCE_NAME}`;
const LINKED_JID = '5491155550003@s.whatsapp.net';
const LINKED_KEY = '541155550003';
const AUDIO_FAILURE = 'No pude escuchar tu audio. Mandalo de nuevo o escribilo.';

const originalFlag = env.WHATSAPP_ENABLED;
const originalSecret = env.WEBHOOK_SECRET;
const originalGroqKey = env.GROQ_API_KEY;

const audioUpsert = {
  event: 'messages.upsert',
  instance: INSTANCE_NAME,
  data: {
    key: { id: 'AUDIO-1', remoteJid: LINKED_JID, fromMe: false },
    message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } }
  }
};

describe('WhatsApp voice notes: download, transcribe, answer', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(chat).mockClear();
    evolution.sendText.mockClear();
    evolution.getBase64FromMedia.mockClear();
    env.WHATSAPP_ENABLED = true;
    env.WEBHOOK_SECRET = SECRET;
    env.GROQ_API_KEY = 'groq-test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ text: 'cuántos pedidos hay hoy' }), { status: 200 }))
    );

    await WhatsappInstance.create({ tenantId: getTestTenantId(), instanceName: INSTANCE_NAME });

    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    await runWithTenancy({ connection, tenantId: String(tenant!._id) }, async () => {
      const user = await User.create({
        name: 'Equipo',
        email: 'audio@test.com',
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
    env.GROQ_API_KEY = originalGroqKey;
    vi.unstubAllGlobals();
  });

  it('downloads the voice note, transcribes it, and answers the transcription', async () => {
    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(evolution.getBase64FromMedia).toHaveBeenCalledWith(INSTANCE_NAME, {
      id: 'AUDIO-1',
      remoteJid: LINKED_JID,
      fromMe: false
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/audio/transcriptions'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(chat).toHaveBeenCalledWith(expect.any(String), 'Equipo', ['orders.manage'], 'cuántos pedidos hay hoy');
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, {
      number: LINKED_JID,
      text: 'Hay 3 pedidos hoy.'
    });
  });

  it('asks the user to repeat when transcription fails, and runs no turn', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, { number: LINKED_JID, text: AUDIO_FAILURE });
  });

  it('asks the user to repeat when the media cannot be downloaded', async () => {
    evolution.getBase64FromMedia.mockResolvedValueOnce({ mimetype: 'audio/ogg' } as unknown as {
      base64: string;
      mimetype: string;
    });

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, { number: LINKED_JID, text: AUDIO_FAILURE });
  });

  it('asks the user to repeat when the transcription is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: '   ' }), { status: 200 }));

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, { number: LINKED_JID, text: AUDIO_FAILURE });
  });

  it('refuses a voice note that is too large, without downloading it to Groq', async () => {
    evolution.getBase64FromMedia.mockResolvedValueOnce({
      base64: 'A'.repeat(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4),
      mimetype: 'audio/ogg'
    });

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, { number: LINKED_JID, text: AUDIO_FAILURE });
  });

  it('refuses media that is not audio', async () => {
    evolution.getBase64FromMedia.mockResolvedValueOnce({ base64: 'T1BVU0VS', mimetype: 'video/mp4' });

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, { number: LINKED_JID, text: AUDIO_FAILURE });
  });

  it('confirms the pending action when the voice note says exactly "sí"', async () => {
    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    const action = await runWithTenancy({ connection, tenantId: String(tenant!._id) }, async () => {
      const user = await User.findOne({ email: 'audio@test.com' });
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
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: 'sí' }), { status: 200 }));

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(confirmAction).toHaveBeenCalledWith(expect.any(String), 'admin', ['orders.manage'], String(action._id));
    expect(chat).not.toHaveBeenCalled();
    expect(evolution.sendText).toHaveBeenCalledWith(INSTANCE_NAME, {
      number: LINKED_JID,
      text: 'Pago registrado.'
    });
  });

  it('accepts an audio file in a format other than ogg', async () => {
    evolution.getBase64FromMedia.mockResolvedValueOnce({ base64: 'T1BVU0VS', mimetype: 'audio/mpeg' });

    await request.post(WEBHOOK_PATH).set('x-webhook-secret', SECRET).send(audioUpsert);
    await waitForIdle();

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/audio/transcriptions'), expect.anything());
    expect(chat).toHaveBeenCalledWith(expect.any(String), 'Equipo', ['orders.manage'], 'cuántos pedidos hay hoy');
  });
});
