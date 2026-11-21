import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  WHATSAPP_INSTANCE_STATES,
  WhatsappInstance,
  type IWhatsappInstance,
  type WhatsappInstanceState
} from '../../tenancy/master-models.js';

/**
 * Webhook authentication and provider status handling.
 *
 * Status events (connection, QR) update the master routing record only. They
 * never touch tenant data, so they are safe to apply before the 200 ack.
 */

export interface WhatsappDelivery {
  /** Normalized event name, e.g. `CONNECTION_UPDATE` (Evolution sends `connection.update`). */
  event: string;
  data: unknown;
}

const STATUS_EVENTS = new Set(['CONNECTION_UPDATE', 'QRCODE_UPDATED']);

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Constant-time shared-secret check. Both sides are hashed first so the
 * comparison always runs over equal-length buffers.
 */
export const isValidWebhookSecret = (provided: string | undefined): boolean => {
  const expected = env.WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
};

export const findWhatsappInstance = (instanceName: string): Promise<IWhatsappInstance | null> =>
  WhatsappInstance.findOne({ instanceName });

/** Parses a provider body. Returns null for anything that is not an event envelope. */
export const parseDelivery = (body: unknown): WhatsappDelivery | null => {
  if (typeof body !== 'object' || body === null) return null;
  const { event, data } = body as { event?: unknown; data?: unknown };
  if (typeof event !== 'string' || event.trim() === '') return null;
  return { event: event.trim().replace(/\./g, '_').toUpperCase(), data };
};

export const isStatusEvent = (delivery: WhatsappDelivery): boolean =>
  STATUS_EVENTS.has(delivery.event);

const toInstanceState = (raw: unknown): WhatsappInstanceState => {
  const candidate = typeof raw === 'string' ? raw.toLowerCase() : '';
  return (WHATSAPP_INSTANCE_STATES as readonly string[]).includes(candidate)
    ? (candidate as WhatsappInstanceState)
    : 'unknown';
};

/** Applies a CONNECTION_UPDATE or QRCODE_UPDATED to the master routing record. */
export const applyStatusEvent = async (
  instanceName: string,
  delivery: WhatsappDelivery
): Promise<void> => {
  const now = new Date();
  const data = (delivery.data ?? {}) as Record<string, unknown>;

  if (delivery.event === 'CONNECTION_UPDATE') {
    const state = toInstanceState(data.state);
    await WhatsappInstance.updateOne(
      { instanceName },
      {
        $set: {
          state,
          stateUpdatedAt: now,
          lastEventAt: now,
          ...(state === 'open' ? { qrCode: null, qrUpdatedAt: null } : {})
        }
      }
    );
    return;
  }

  if (delivery.event === 'QRCODE_UPDATED') {
    const qrcode = (data.qrcode ?? {}) as { base64?: unknown; code?: unknown };
    const payload = typeof qrcode.base64 === 'string' ? qrcode.base64 : null;
    await WhatsappInstance.updateOne(
      { instanceName },
      { $set: { qrCode: payload, qrUpdatedAt: now, lastEventAt: now } }
    );
  }
};
