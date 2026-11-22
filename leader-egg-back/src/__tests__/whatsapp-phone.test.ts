import { describe, it, expect } from 'vitest';
import { normalizeWhatsappSender } from '../modules/whatsapp/phone.js';

describe('normalizeWhatsappSender', () => {
  it('maps the 549 mobile form and the 54 form to one canonical key', () => {
    const mobile = normalizeWhatsappSender('5491112345678@s.whatsapp.net');
    const landline = normalizeWhatsappSender('541112345678@s.whatsapp.net');

    expect(mobile?.key).toBe('541112345678');
    expect(landline?.key).toBe('541112345678');
  });

  it('keeps the original JID as replyJid for each variant', () => {
    expect(normalizeWhatsappSender('5491112345678@s.whatsapp.net')?.replyJid).toBe(
      '5491112345678@s.whatsapp.net'
    );
    expect(normalizeWhatsappSender('541112345678@s.whatsapp.net')?.replyJid).toBe(
      '541112345678@s.whatsapp.net'
    );
  });

  it('strips the multi-device suffix before normalizing', () => {
    expect(normalizeWhatsappSender('5491112345678:12@s.whatsapp.net')?.key).toBe('541112345678');
  });

  it('keeps non-Argentine numbers as-is', () => {
    expect(normalizeWhatsappSender('14155550123@s.whatsapp.net')).toEqual({
      key: '14155550123',
      replyJid: '14155550123@s.whatsapp.net'
    });
  });

  it('resolves @lid senders through remoteJidAlt', () => {
    const resolved = normalizeWhatsappSender(
      '123456789@lid',
      '5491112345678@s.whatsapp.net'
    );

    expect(resolved).toEqual({
      key: '541112345678',
      replyJid: '5491112345678@s.whatsapp.net'
    });
  });

  it('returns null for @lid senders without a usable remoteJidAlt', () => {
    expect(normalizeWhatsappSender('123456789@lid')).toBeNull();
    expect(normalizeWhatsappSender('123456789@lid', '987654321@lid')).toBeNull();
  });

  it('rejects group chats', () => {
    expect(normalizeWhatsappSender('120363000000000000@g.us')).toBeNull();
  });

  it('rejects broadcast and status senders', () => {
    expect(normalizeWhatsappSender('status@broadcast')).toBeNull();
    expect(normalizeWhatsappSender('5491112345678@broadcast')).toBeNull();
  });

  it('rejects user parts that are not digits', () => {
    expect(normalizeWhatsappSender('abc@s.whatsapp.net')).toBeNull();
  });
});
