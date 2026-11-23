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
import { WhatsappAllowedNumber } from '../modules/whatsapp/model.js';
import { parseInboundMessage } from '../modules/whatsapp/inbound.js';
import { waitForIdle } from '../modules/whatsapp/queue.js';
import { runWhatsappTurn } from '../modules/whatsapp/turn.js';
import { Types } from 'mongoose';

vi.mock('../modules/whatsapp/turn.js', () => ({
  runWhatsappTurn: vi.fn(async () => undefined)
}));

const request = supertest(app);

const INSTANCE_NAME = 'tenant-test-inbound';
const SECRET = 'y'.repeat(40);
const WEBHOOK_PATH = `/api/v1/whatsapp/webhook/${INSTANCE_NAME}`;
const LINKED_JID = '5491155550001@s.whatsapp.net';
/** Canonical key: the mobile "9" is dropped (see phone.ts). */
const LINKED_PHONE = '541155550001';
const UNLINKED_JID = '5491155550999@s.whatsapp.net';

const originalFlag = env.WHATSAPP_ENABLED;
const originalSecret = env.WEBHOOK_SECRET;

const textUpsert = (remoteJid: string, text: string, id = 'MSG-1') => ({
  event: 'messages.upsert',
  instance: INSTANCE_NAME,
  data: {
    key: { id, remoteJid, fromMe: false },
    message: { conversation: text }
  }
});

describe('parseInboundMessage (pure)', () => {
  it('reads a plain text message from a user JID', () => {
    const parsed = parseInboundMessage({
      event: 'MESSAGES_UPSERT',
      data: { key: { id: 'A1', remoteJid: LINKED_JID, fromMe: false }, message: { conversation: 'hola' } }
    });
    expect(parsed).toEqual({
      kind: 'text',
      providerMessageId: 'A1',
      senderKey: LINKED_PHONE,
      replyJid: LINKED_JID,
      text: 'hola'
    });
  });

  it('reads extended text messages too', () => {
    const parsed = parseInboundMessage({
      event: 'MESSAGES_UPSERT',
      data: {
        key: { id: 'A2', remoteJid: LINKED_JID, fromMe: false },
        message: { extendedTextMessage: { text: 'con link' } }
      }
    });
    expect(parsed).toMatchObject({ kind: 'text', text: 'con link' });
  });

  it('ignores messages sent by the business itself', () => {
    expect(
      parseInboundMessage({
        event: 'MESSAGES_UPSERT',
        data: { key: { id: 'A3', remoteJid: LINKED_JID, fromMe: true }, message: { conversation: 'x' } }
      })
    ).toBeNull();
  });

  it('ignores groups and message types it does not handle', () => {
    expect(
      parseInboundMessage({
        event: 'MESSAGES_UPSERT',
        data: { key: { id: 'A4', remoteJid: '120363@g.us', fromMe: false }, message: { conversation: 'x' } }
      })
    ).toBeNull();
    expect(
      parseInboundMessage({
        event: 'MESSAGES_UPSERT',
        data: { key: { id: 'A5', remoteJid: LINKED_JID, fromMe: false }, message: { stickerMessage: {} } }
      })
    ).toBeNull();
  });

  it('reads voice notes as audio, keeping the key the media download needs', () => {
    expect(
      parseInboundMessage({
        event: 'MESSAGES_UPSERT',
        data: { key: { id: 'A6', remoteJid: LINKED_JID, fromMe: false }, message: { audioMessage: {} } }
      })
    ).toEqual({
      kind: 'audio',
      providerMessageId: 'A6',
      senderKey: LINKED_PHONE,
      replyJid: LINKED_JID,
      messageKey: { id: 'A6', remoteJid: LINKED_JID, fromMe: false }
    });
  });

  it('reads images and locations', () => {
    expect(
      parseInboundMessage({
        event: 'MESSAGES_UPSERT',
        data: { key: { id: 'A7', remoteJid: LINKED_JID, fromMe: false }, message: { imageMessage: {} } }
      })?.kind
    ).toBe('image');
    expect(
      parseInboundMessage({
        event: 'MESSAGES_UPSERT',
        data: {
          key: { id: 'A8', remoteJid: LINKED_JID, fromMe: false },
          message: { locationMessage: { degreesLatitude: -34.6, degreesLongitude: -58.4 } }
        }
      })
    ).toMatchObject({ kind: 'location', location: { lat: -34.6, lng: -58.4 } });
  });

  it('ignores other events', () => {
    expect(parseInboundMessage({ event: 'CONNECTION_UPDATE', data: {} })).toBeNull();
  });
});

describe('WhatsApp webhook: inbound text routing', () => {
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

    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    await runWithTenancy({ connection, tenantId: String(tenant!._id) }, async () => {
      await WhatsappAllowedNumber.create({ phone: LINKED_PHONE, userId: new Types.ObjectId() });
    });
  });

  afterEach(() => {
    env.WHATSAPP_ENABLED = originalFlag;
    env.WEBHOOK_SECRET = originalSecret;
  });

  it('hands a linked number text to the turn with its tenant and user', async () => {
    const response = await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send(textUpsert(LINKED_JID, 'cuántos pedidos hay hoy', 'MSG-LINKED'));

    expect(response.status).toBe(200);
    await waitForIdle();

    expect(runWhatsappTurn).toHaveBeenCalledTimes(1);
    expect(runWhatsappTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: getTestTenantId(),
        phone: LINKED_PHONE,
        replyJid: LINKED_JID,
        providerMessageId: 'MSG-LINKED',
        kind: 'text',
        text: 'cuántos pedidos hay hoy',
        userId: expect.any(String)
      })
    );
  });

  it('gives a number that is not linked nothing: no turn runs', async () => {
    const response = await request
      .post(WEBHOOK_PATH)
      .set('x-webhook-secret', SECRET)
      .send(textUpsert(UNLINKED_JID, 'hola', 'MSG-UNLINKED'));

    expect(response.status).toBe(200);
    await waitForIdle();

    expect(runWhatsappTurn).not.toHaveBeenCalled();
  });
});
