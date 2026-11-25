import {
  Tenant,
  WhatsappInstance,
  type IWhatsappInstance,
  type WhatsappInstanceState
} from '../../tenancy/master-models.js';
import { AppError } from '../../middleware/error-handler.js';
import { env } from '../../config/env.js';
import { getEvolutionClient } from './evolution-client.js';

/** What the admin in Settings sees. The QR is only useful until the line is open. */
export interface WhatsappConnectionView {
  state: WhatsappInstanceState | 'not_created';
  qrCode: string | null;
}

const toView = (doc: IWhatsappInstance | null): WhatsappConnectionView => {
  if (!doc) return { state: 'not_created', qrCode: null };
  return { state: doc.state, qrCode: doc.state === 'open' ? null : (doc.qrCode ?? null) };
};

export const getWhatsappConnection = async (tenantId: string): Promise<WhatsappConnectionView> =>
  toView(await WhatsappInstance.findOne({ tenantId }));

/**
 * Creates the tenant's Evolution instance on first use, then asks for a QR code.
 * Later state and QR changes arrive through the webhook.
 */
export const connectWhatsapp = async (tenantId: string): Promise<WhatsappConnectionView> => {
  const { WEBHOOK_SECRET: webhookSecret, WHATSAPP_WEBHOOK_BASE_URL: baseUrl } = env;
  if (!webhookSecret || !baseUrl) throw new AppError('WhatsApp is not configured', 503);

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new AppError('Negocio no encontrado', 404);

  const evolution = getEvolutionClient();
  let doc = await WhatsappInstance.findOne({ tenantId });
  if (!doc) {
    const instanceName = `tenant-${tenant.slug}`;
    await evolution.createInstance({
      instanceName,
      webhookUrl: `${baseUrl}/api/v1/whatsapp/webhook/${instanceName}`,
      webhookSecret
    });
    doc = await WhatsappInstance.create({ tenantId, instanceName });
  }

  const payload = await evolution.connectInstance(doc.instanceName);
  if (typeof payload.base64 === 'string') {
    await WhatsappInstance.updateOne(
      { _id: doc._id },
      { $set: { qrCode: payload.base64, qrUpdatedAt: new Date() } }
    );
  }
  return toView(await WhatsappInstance.findById(doc._id));
};
