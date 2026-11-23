import { runWithTenancy } from '../../tenancy/context.js';
import { getTenantConnection } from '../../tenancy/registry.js';
import { Tenant, type IWhatsappInstance } from '../../tenancy/master-models.js';
import {
  INBOUND_EVENT_TTL_DAYS,
  WhatsappAllowedNumber,
  WhatsappInboundEvent
} from './model.js';
import type { InboundMessage } from './inbound.js';
import { getEvolutionClient } from './evolution-client.js';
import { transcribeAudio } from './media.js';
import { runWhatsappTurn, type WhatsappTurnInput } from './turn.js';

const AUDIO_FAILURE_REPLY = 'No pude escuchar tu audio. Mandalo de nuevo o escribilo.';
const DUPLICATE_KEY = 11000;

/** False when this provider message id was already handled (the provider redelivered it). */
const claimInbound = async (providerMessageId: string, phone: string): Promise<boolean> => {
  try {
    await WhatsappInboundEvent.create({
      providerMessageId,
      phone,
      status: 'received',
      expiresAt: new Date(Date.now() + INBOUND_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000)
    });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
    throw error;
  }
};

/**
 * Routes one inbound message to the assistant, inside the instance's tenant.
 *
 * A sender that is not linked to a user gets nothing: no reply and no turn.
 * Failures throw; the queue swallows them so later messages keep flowing.
 */
export const handleInbound = async (
  instance: IWhatsappInstance,
  inbound: InboundMessage
): Promise<void> => {
  const tenant = await Tenant.findById(instance.tenantId);
  if (!tenant || !tenant.active) return;

  const tenantId = String(tenant._id);
  const connection = getTenantConnection(tenant.dbName);

  await runWithTenancy({ connection, tenantId }, async () => {
    const allowed = await WhatsappAllowedNumber.findOne({ phone: inbound.senderKey });
    if (!allowed) return;
    if (!(await claimInbound(inbound.providerMessageId, inbound.senderKey))) return;

    const base = {
      instanceName: instance.instanceName,
      tenantId,
      userId: String(allowed.userId),
      phone: inbound.senderKey,
      replyJid: inbound.replyJid,
      providerMessageId: inbound.providerMessageId
    } satisfies Omit<WhatsappTurnInput, 'kind'>;

    if (inbound.kind === 'audio') {
      const text = await transcribeAudio(instance.instanceName, inbound.messageKey).catch(() => '');
      if (text.trim()) {
        await runWhatsappTurn({ ...base, kind: 'audio', text });
      } else {
        await getEvolutionClient().sendText(instance.instanceName, {
          number: inbound.replyJid,
          text: AUDIO_FAILURE_REPLY
        });
      }
      return;
    }

    if (inbound.kind === 'text') {
      await runWhatsappTurn({ ...base, kind: 'text', text: inbound.text });
      return;
    }

    if (inbound.kind === 'location') {
      await runWhatsappTurn({ ...base, kind: 'location', location: inbound.location });
      return;
    }

    await runWhatsappTurn({ ...base, kind: 'image' });
  });
};
