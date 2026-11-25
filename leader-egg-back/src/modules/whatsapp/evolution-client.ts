import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error-handler.js';

/**
 * Thin REST wrapper over Evolution API v2 (Baileys).
 *
 * Every call sends the `apikey` header. Provider responses are returned as
 * parsed JSON to callers and never logged. Error messages are fixed strings so
 * neither the API key nor the provider body can leak into a reply or log line.
 */

export const EVOLUTION_TIMEOUT_MS = 15_000;

const WEBHOOK_EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'] as const;

export const MESSAGES = {
  unreachable: 'WhatsApp provider is unreachable',
  unauthorized: 'WhatsApp provider rejected the credentials',
  notFound: 'WhatsApp instance not found',
  busy: 'WhatsApp provider is busy, try again later',
  failed: 'WhatsApp provider returned an error'
} as const;

export type EvolutionPayload = Record<string, unknown>;

export interface EvolutionClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface EvolutionMessageKey {
  id: string;
  remoteJid: string;
  fromMe: boolean;
}

export interface EvolutionClient {
  createInstance(input: {
    instanceName: string;
    webhookUrl: string;
    webhookSecret: string;
  }): Promise<EvolutionPayload>;
  connectInstance(instanceName: string): Promise<EvolutionPayload>;
  connectionState(instanceName: string): Promise<EvolutionPayload>;
  logoutInstance(instanceName: string): Promise<EvolutionPayload>;
  sendText(instanceName: string, input: { number: string; text: string }): Promise<EvolutionPayload>;
  getBase64FromMedia(
    instanceName: string,
    key: EvolutionMessageKey,
    convertToMp4?: boolean
  ): Promise<EvolutionPayload>;
}

/** Maps a non-2xx status to a fixed, provider-agnostic AppError. */
const errorForStatus = (status: number): AppError => {
  if (status === 401 || status === 403) return new AppError(MESSAGES.unauthorized, 503);
  if (status === 404) return new AppError(MESSAGES.notFound, 404);
  if (status === 429) return new AppError(MESSAGES.busy, 429);
  return new AppError(MESSAGES.failed, 502);
};

export const createEvolutionClient = (config: EvolutionClientConfig): EvolutionClient => {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? EVOLUTION_TIMEOUT_MS;

  const request = async (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<EvolutionPayload> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          apikey: config.apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw errorForStatus(response.status);
      }

      // Some endpoints answer with an empty body; treat it as an empty payload.
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text) as EvolutionPayload;
      } catch {
        throw new AppError(MESSAGES.failed, 502);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Covers abort (timeout), DNS and socket failures alike. The raw error is
      // dropped on purpose: it may echo request headers.
      throw new AppError(MESSAGES.unreachable, 503);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    createInstance: ({ instanceName, webhookUrl, webhookSecret }) =>
      request('POST', '/instance/create', {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: { 'x-webhook-secret': webhookSecret },
          byEvents: false,
          base64: false,
          events: [...WEBHOOK_EVENTS]
        }
      }),
    connectInstance: (instanceName) => request('GET', `/instance/connect/${instanceName}`),
    connectionState: (instanceName) =>
      request('GET', `/instance/connectionState/${instanceName}`),
    logoutInstance: (instanceName) => request('DELETE', `/instance/logout/${instanceName}`),
    sendText: (instanceName, input) =>
      request('POST', `/message/sendText/${instanceName}`, input),
    getBase64FromMedia: (instanceName, key, convertToMp4 = false) =>
      request('POST', `/chat/getBase64FromMediaMessage/${instanceName}`, {
        message: { key },
        convertToMp4
      })
  };
};

/**
 * Client bound to the current environment. Throws a fixed 503 when the
 * WhatsApp feature is not configured, so callers never send with empty creds.
 */
export const getEvolutionClient = (): EvolutionClient => {
  if (!env.EVOLUTION_URL || !env.EVOLUTION_API_KEY) {
    throw new AppError('WhatsApp is not configured', 503);
  }
  return createEvolutionClient({ baseUrl: env.EVOLUTION_URL, apiKey: env.EVOLUTION_API_KEY });
};
