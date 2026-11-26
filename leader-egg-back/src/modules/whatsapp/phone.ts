/**
 * Pure sender normalization for WhatsApp JIDs.
 *
 * Argentine mobiles arrive as `549<area><number>` in some deliveries and as
 * `54<area><number>` in others. Whitelist matching uses the canonical key
 * (country code 54, without the mobile "9"). Replies go to the JID exactly as
 * it was delivered, kept in `replyJid`.
 */

export interface WhatsappSender {
  /** Canonical digits used for whitelist matching. */
  key: string;
  /** User JID used as the reply target (multi-device suffix stripped). */
  replyJid: string;
}

const USER_JID_SUFFIX = '@s.whatsapp.net';
const LID_SUFFIX = '@lid';
const USER_DIGITS = /^\d{6,20}$/;

const canonicalKey = (digits: string): string =>
  digits.startsWith('549') ? `54${digits.slice(3)}` : digits;

/**
 * Canonical key for a phone typed by a person ("+54 9 2622 517447", "54-2622-517447", …).
 * Returns null unless the number carries the country code, because a bare local number
 * has no reliable country and must not be stored as a link.
 */
export const canonicalPhoneKey = (input: string): string | null => {
  const digits = input.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!USER_DIGITS.test(digits) || !digits.startsWith('54')) return null;
  return canonicalKey(digits);
};

const parseUserJid = (jid: string): WhatsappSender | null => {
  if (!jid.endsWith(USER_JID_SUFFIX)) return null;

  const digits = jid.slice(0, -USER_JID_SUFFIX.length).replace(/:\d+$/, '');
  if (!USER_DIGITS.test(digits)) return null;

  return {
    key: canonicalKey(digits),
    replyJid: `${digits}${USER_JID_SUFFIX}`
  };
};

/**
 * Resolves a delivery's sender. `@lid` senders are only usable through
 * `remoteJidAlt`; without a usable alternate JID they return null. Groups,
 * broadcasts and any other suffix return null.
 */
export const normalizeWhatsappSender = (
  remoteJid: string,
  remoteJidAlt?: string | null
): WhatsappSender | null => {
  if (remoteJid.endsWith(LID_SUFFIX)) {
    return remoteJidAlt ? parseUserJid(remoteJidAlt) : null;
  }
  return parseUserJid(remoteJid);
};
