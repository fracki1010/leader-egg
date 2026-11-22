import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEvolutionClient, getEvolutionClient } from '../modules/whatsapp/evolution-client.js';
import { AppError } from '../middleware/error-handler.js';

const BASE_URL = 'http://evolution-api:8080';
const API_KEY = 'evolution-secret-key-do-not-leak';

const jsonResponse = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const client = (timeoutMs?: number) =>
  createEvolutionClient({ baseUrl: BASE_URL, apiKey: API_KEY, timeoutMs });

describe('Evolution client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the apikey header on every call', async () => {
    await client().connectionState('tenant-acme');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/instance/connectionState/tenant-acme`);
    expect((init.headers as Record<string, string>).apikey).toBe(API_KEY);
  });

  it('creates an instance with QR, webhook url, secret header and events', async () => {
    await client().createInstance({
      instanceName: 'tenant-acme',
      webhookUrl: 'http://api:3000/api/v1/whatsapp/webhook/tenant-acme',
      webhookSecret: 'webhook-secret-value'
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(url).toBe(`${BASE_URL}/instance/create`);
    expect(init.method).toBe('POST');
    expect(body.instanceName).toBe('tenant-acme');
    expect(body.qrcode).toBe(true);
    expect(body.webhook.url).toBe('http://api:3000/api/v1/whatsapp/webhook/tenant-acme');
    expect(body.webhook.headers).toEqual({ 'x-webhook-secret': 'webhook-secret-value' });
    expect(body.webhook.base64).toBe(false);
    expect(body.webhook.events).toEqual(
      expect.arrayContaining(['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'])
    );
  });

  it('sends number and text for sendText', async () => {
    await client().sendText('tenant-acme', { number: '5491112345678', text: 'hola' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/message/sendText/tenant-acme`);
    expect(JSON.parse(init.body as string)).toEqual({ number: '5491112345678', text: 'hola' });
  });

  it('uses DELETE for logout and GET for connect', async () => {
    await client().logoutInstance('tenant-acme');
    await client().connectInstance('tenant-acme');

    const [logoutUrl, logoutInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [connectUrl, connectInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(logoutUrl).toBe(`${BASE_URL}/instance/logout/tenant-acme`);
    expect(logoutInit.method).toBe('DELETE');
    expect(connectUrl).toBe(`${BASE_URL}/instance/connect/tenant-acme`);
    expect(connectInit.method ?? 'GET').toBe('GET');
  });

  it('requests base64 media by message key', async () => {
    await client().getBase64FromMedia('tenant-acme', {
      id: 'MSG-1',
      remoteJid: '5491112345678@s.whatsapp.net',
      fromMe: false
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/chat/getBase64FromMediaMessage/tenant-acme`);
    expect(JSON.parse(init.body as string)).toEqual({
      message: {
        key: { id: 'MSG-1', remoteJid: '5491112345678@s.whatsapp.net', fromMe: false }
      },
      convertToMp4: false
    });
  });

  it('maps a network failure to a fixed message without leaking the key', async () => {
    fetchMock.mockRejectedValue(new Error(`socket hang up with key ${API_KEY}`));

    const error = await client()
      .connectionState('tenant-acme')
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(503);
    expect((error as AppError).message).toBe('WhatsApp provider is unreachable');
    expect((error as AppError).message).not.toContain(API_KEY);
  });

  it('maps a 401 to a credentials message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: API_KEY }));

    await expect(client().connectionState('tenant-acme')).rejects.toMatchObject({
      status: 503,
      message: 'WhatsApp provider rejected the credentials'
    });
  });

  it('maps a 500 to a generic error that never echoes the provider body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: `boom ${API_KEY}` }));

    const error = await client()
      .sendText('tenant-acme', { number: '5491112345678', text: 'x' })
      .catch((err: unknown) => err);

    expect((error as AppError).status).toBe(502);
    expect((error as AppError).message).toBe('WhatsApp provider returned an error');
    expect((error as AppError).message).not.toContain(API_KEY);
  });

  it('maps a 404 to an instance-not-found message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404));

    await expect(client().connectionState('missing')).rejects.toMatchObject({
      status: 404,
      message: 'WhatsApp instance not found'
    });
  });

  it('maps a 429 to a busy message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429));

    await expect(client().connectionState('tenant-acme')).rejects.toMatchObject({
      status: 429,
      message: 'WhatsApp provider is busy, try again later'
    });
  });

  it('aborts a request that exceeds the timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    await expect(client(20).connectionState('tenant-acme')).rejects.toMatchObject({
      status: 503,
      message: 'WhatsApp provider is unreachable'
    });
  });

  it('refuses to build a client from env when WhatsApp is not configured', async () => {
    // Re-import under a disabled flag so the result does not depend on the
    // caller's environment.
    vi.stubEnv('WHATSAPP_ENABLED', 'false');
    vi.stubEnv('EVOLUTION_URL', '');
    vi.stubEnv('EVOLUTION_API_KEY', '');
    vi.resetModules();

    const fresh = await import('../modules/whatsapp/evolution-client.js');
    expect(() => fresh.getEvolutionClient()).toThrow('WhatsApp is not configured');

    vi.unstubAllEnvs();
  });
});
