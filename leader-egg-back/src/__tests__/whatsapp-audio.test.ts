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

const evolution = vi.hoisted(() => ({
  sendText: vi.fn(async () => ({})),
  getBase64FromMedia: vi.fn(async () => ({ base64: 'T1BVU0VS', mimetype: 'audio/ogg' }))
}));

vi.mock('../modules/agent/service.js', () => ({
  chat: vi.fn(async () => ({ reply: 'Hay 3 pedidos hoy.', toolCalls: [], actions: [] }))
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
});
