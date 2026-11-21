/**
 * Turn seam for inbound WhatsApp messages.
 *
 * Slice b stub: the agent is not connected yet, so an accepted message gets no
 * agent call and no reply. Slice c replaces this body with the agent turn
 * (transcript port, confirm handling and text reply).
 */

export interface WhatsappTurnInput {
  tenantId: string;
  userId: string;
  /** Canonical phone key (whitelist identity). */
  phone: string;
  /** Digits as delivered, used for replies. */
  replyJid: string;
  providerMessageId: string;
  kind: 'text' | 'audio' | 'image' | 'location';
  text?: string;
}

export const runWhatsappTurn = async (_input: WhatsappTurnInput): Promise<void> => {
  // Intentionally empty until slice c.
};
