import { normalizeWhatsappSender } from './phone.js';
import type { EvolutionMessageKey } from './evolution-client.js';
import type { WhatsappDelivery } from './webhook-service.js';

/**
 * Inbound messages from the provider's `messages.upsert` event, from user
 * chats only. Sticker, video, document and other types return null.
 */
interface InboundBase {
  providerMessageId: string;
  /** Canonical sender key, used to find the linked user. */
  senderKey: string;
  /** Digits as delivered, used for replies. */
  replyJid: string;
}

export type InboundMessage =
  | (InboundBase & { kind: 'text'; text: string })
  | (InboundBase & { kind: 'audio'; messageKey: EvolutionMessageKey })
  | (InboundBase & { kind: 'image' })
  | (InboundBase & { kind: 'location'; location: { lat: number; lng: number } });

interface MessageKey {
  id?: unknown;
  remoteJid?: unknown;
  remoteJidAlt?: unknown;
  fromMe?: unknown;
}

interface MessageBody {
  conversation?: unknown;
  extendedTextMessage?: { text?: unknown };
  audioMessage?: unknown;
  imageMessage?: unknown;
  locationMessage?: { degreesLatitude?: unknown; degreesLongitude?: unknown };
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Reads an inbound, non-self message from a user chat, or returns null for anything else. */
export const parseInboundMessage = (delivery: WhatsappDelivery): InboundMessage | null => {
  if (delivery.event !== 'MESSAGES_UPSERT') return null;

  const data = delivery.data as { key?: MessageKey; message?: MessageBody } | null | undefined;
  const key = data?.key;
  if (!key || key.fromMe !== false) return null;

  const providerMessageId = asString(key.id);
  const remoteJid = asString(key.remoteJid);
  if (!providerMessageId || !remoteJid) return null;

  const sender = normalizeWhatsappSender(remoteJid, asString(key.remoteJidAlt));
  if (!sender) return null;

  const base = { providerMessageId, senderKey: sender.key, replyJid: sender.replyJid };
  const message = data?.message;

  const text = asString(message?.conversation) ?? asString(message?.extendedTextMessage?.text);
  if (text) return { ...base, kind: 'text', text };

  if (message?.audioMessage) {
    return {
      ...base,
      kind: 'audio',
      messageKey: { id: providerMessageId, remoteJid, fromMe: false }
    };
  }

  if (message?.imageMessage) return { ...base, kind: 'image' };

  const lat = asNumber(message?.locationMessage?.degreesLatitude);
  const lng = asNumber(message?.locationMessage?.degreesLongitude);
  if (lat !== null && lng !== null) return { ...base, kind: 'location', location: { lat, lng } };

  return null;
};
