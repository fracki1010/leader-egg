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
  // Waiting for a scan, the stored QR is the one the last connect issued, so it stays visible.
  // After a disconnect it is shown only if it was issued after that change; an older one is stale.
  const waitingForScan = doc.state === 'created' || doc.state === 'connecting';
  const issuedAfterChange =
    doc.qrUpdatedAt != null && (!doc.stateUpdatedAt || doc.qrUpdatedAt > doc.stateUpdatedAt);
  const show = doc.qrCode != null && (waitingForScan || (doc.state !== 'open' && issuedAfterChange));
  return { state: doc.state, qrCode: show ? (doc.qrCode ?? null) : null };
};

export const getWhatsappConnection = async (tenantId: string): Promise<WhatsappConnectionView> =>
  toView(await WhatsappInstance.findOne({ tenantId }));

/**
 * Whether Evolution already has the instance. A 404 means no; any other failure
 * rethrows, so an unreachable provider never leads to a blind create.
 */
const instanceExists = async (
  evolution: ReturnType<typeof getEvolutionClient>,
  instanceName: string
): Promise<boolean> => {
  try {
    await evolution.connectionState(instanceName);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return false;
    throw error;
  }
};

/**
 * Creates the tenant's Evolution instance on first use, then asks for a QR code.
 * Later state and QR changes arrive through the webhook.
 */
export const connectWhatsapp = async (tenantId: string): Promise<WhatsappConnectionView> => {
  const { WEBHOOK_SECRET: webhookSecret, WHATSAPP_WEBHOOK_BASE_URL: baseUrl } = env;
  // Without the flag the webhook is closed, so a line created now could never report back.
  if (!env.WHATSAPP_ENABLED || !webhookSecret || !baseUrl) {
    throw new AppError('WhatsApp is not configured', 503);
  }

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
    // Only one connect works on the instance at a time: a live lease held by another
    // one makes this connect back off, and an expired lease (left by a crash) is taken over.
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
      // Probe first: a previous create may have landed although its reply was lost.
      if (!(await instanceExists(evolution, doc.instanceName))) {
        await evolution.createInstance({
          instanceName: doc.instanceName,
          webhookUrl: `${baseUrl}/api/v1/whatsapp/webhook/${doc.instanceName}`,
          webhookSecret
        });
      }
      const marked = await WhatsappInstance.updateOne(
        { _id: doc._id },
        { $set: { providerCreated: true, leaseUntil: null } }
      );
      if (marked.matchedCount === 0) {
        // The business was deleted while its line was being created: do not leave the line behind.
        await evolution.deleteInstance(doc.instanceName);
        throw new AppError('Negocio no encontrado', 404);
      }
    } catch (error) {
      // Only the lease this connect took is released, never a newer one.
      await WhatsappInstance.updateOne({ _id: doc._id, leaseUntil }, { $set: { leaseUntil: null } });
      throw error;
    }
  }

  let payload = await evolution.connectInstance(doc.instanceName);
  // A stuck "connecting" instance answers without a QR; restarting it makes Evolution issue one.
  // Never restart an open line: that would unlink the phone.
  if (typeof payload.base64 !== 'string' && doc.state !== 'open') {
    await evolution.restartInstance(doc.instanceName);
    payload = await evolution.connectInstance(doc.instanceName);
  }
  if (typeof payload.base64 === 'string') {
    await WhatsappInstance.updateOne(
      { _id: doc._id },
      { $set: { qrCode: payload.base64, qrUpdatedAt: new Date() } }
    );
  }
  return toView(await WhatsappInstance.findById(doc._id));
};
