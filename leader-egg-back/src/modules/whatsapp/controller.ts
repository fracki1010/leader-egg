import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error-handler.js';
import {
  applyStatusEvent,
  findWhatsappInstance,
  isStatusEvent,
  isValidWebhookSecret,
  parseDelivery
} from './webhook-service.js';

/**
 * Evolution webhook receiver. Authenticated by the shared secret header, never
 * by JWT. Order matters: flag and instance checks answer 404 before the secret
 * is compared, and the secret is checked before anything else is read.
 */
export const webhookHandler = async (request: Request, response: Response): Promise<void> => {
  if (!env.WHATSAPP_ENABLED) {
    throw new AppError('Not found', 404);
  }

  const instanceName = String(request.params.instanceName ?? '');
  const instance = await findWhatsappInstance(instanceName);
  if (!instance) {
    throw new AppError('Not found', 404);
  }

  if (!isValidWebhookSecret(request.get('x-webhook-secret'))) {
    throw new AppError('Invalid webhook secret', 401);
  }

  const delivery = parseDelivery(request.body);

  // Status events are small master-DB writes, applied before the ack.
  if (delivery && isStatusEvent(delivery)) {
    await applyStatusEvent(instanceName, delivery);
  }

  response.status(200).json({ received: true });
};
