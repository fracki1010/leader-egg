import {
  Tenant,
  WhatsappInstance,
  type IWhatsappInstance,
  type WhatsappInstanceState
} from '../../tenancy/master-models.js';
import { AppError } from '../../middleware/error-handler.js';
import { env } from '../../config/env.js';
import { getEvolutionClient } from './evolution-client.js';

/** How long one connect holds the right to create the instance. A crash expires it. */
const CREATE_LEASE_MS = 60_000;

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
  // Atomic upsert: one record per tenant, however many connects race.
  const doc = (await WhatsappInstance.findOneAndUpdate(
    { tenantId },
    { $setOnInsert: { instanceName: `tenant-${tenant.slug}` } },
    { upsert: true, new: true }
  ))!;

  if (!doc.providerCreated) {
    // Only one connect creates at a time: a live lease held by another one makes this
    // connect back off, and an expired lease (left by a crash) is taken over.
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + CREATE_LEASE_MS);
    const lease = await WhatsappInstance.updateOne(
      {
        _id: doc._id,
        providerCreated: { $ne: true },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }]
      },
      { $set: { leaseUntil } }
    );
    if (lease.modifiedCount === 0) {
      throw new AppError('WhatsApp se está conectando. Probá de nuevo en unos segundos.', 409);
    }

    try {
      await evolution.createInstance({
        instanceName: doc.instanceName,
        webhookUrl: `${baseUrl}/api/v1/whatsapp/webhook/${doc.instanceName}`,
        webhookSecret
      });
    } catch (error) {
      // The call can fail after Evolution created the instance (timeout, lost reply).
      // Probe it: if it exists, record it and go on; otherwise free our lease and fail.
      let exists = true;
      try {
        await evolution.connectionState(doc.instanceName);
      } catch {
        exists = false;
      }
      if (!exists) {
        // Only the lease this connect took is released, never a newer one.
        await WhatsappInstance.updateOne({ _id: doc._id, leaseUntil }, { $set: { leaseUntil: null } });
        throw error;
      }
    }
    await WhatsappInstance.updateOne(
      { _id: doc._id },
      { $set: { providerCreated: true, leaseUntil: null } }
    );
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
