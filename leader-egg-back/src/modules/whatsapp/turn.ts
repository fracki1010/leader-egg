import { chat } from '../agent/service.js';
import { User } from '../auth/model.js';
import { getEvolutionClient } from './evolution-client.js';
import { handleDecision, parseDecision } from './confirmation.js';

/**
 * Turn for inbound WhatsApp messages.
 *
 * Text (typed, or a voice note's transcription) is either a yes/no for a
 * pending action or a message for the agent. Images get a fixed reply. The reply
 * goes back to the same chat.
 */

const FAILURE_REPLY = 'No pude procesar tu mensaje. Intentalo de nuevo en un momento.';
const IMAGE_REPLY = 'Por ahora no puedo leer imágenes. Escribime lo que necesitás.';

export interface WhatsappTurnInput {
  instanceName: string;
  tenantId: string;
  userId: string;
  /** Canonical phone key (whitelist identity). */
  phone: string;
  /** Digits as delivered, used for replies. */
  replyJid: string;
  providerMessageId: string;
  kind: 'text' | 'audio' | 'image' | 'location';
  /** Typed text, or a voice note's transcription. */
  text?: string;
  location?: { lat: number; lng: number };
}

/** The agent's answer to a text, or null when the sender has no user. */
const answerText = async (input: WhatsappTurnInput, text: string): Promise<string | null> => {
  try {
    const user = await User.findById(input.userId).select('name role permissions');
    if (!user) return null;

    const caller = { userId: input.userId, role: user.role, permissions: user.permissions ?? [] };
    const decision = parseDecision(text);
    const decisionReply = decision ? await handleDecision(caller, decision) : null;

    return decisionReply ?? (await chat(input.userId, user.name, caller.permissions, text)).reply;
  } catch {
    // The user is told the turn failed; nothing is written on this path.
    return FAILURE_REPLY;
  }
};

export const runWhatsappTurn = async (input: WhatsappTurnInput): Promise<void> => {
  const evolution = getEvolutionClient();

  let reply: string | null = null;
  if (input.kind === 'image') {
    reply = IMAGE_REPLY;
  } else if ((input.kind === 'text' || input.kind === 'audio') && input.text) {
    reply = await answerText(input, input.text);
  } else if (input.kind === 'location' && input.location) {
    const { lat, lng } = input.location;
    reply = await answerText(
      input,
      `[Ubicación enviada: lat ${lat}, lng ${lng}. Si el usuario pide guardarla en un cliente, usá prepare_customer_location con el nombre exacto del cliente.]`
    );
  }

  if (reply === null) return;
  await evolution.sendText(input.instanceName, { number: input.replyJid, text: reply });
};
