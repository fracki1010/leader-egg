import { describe, it, expect } from 'vitest';
import { canonicalPhoneKey, normalizeWhatsappSender } from '../modules/whatsapp/phone.js';

describe('canonicalPhoneKey (AC5: one key for every written form)', () => {
  it('gives the same key for the common written forms of one Argentine mobile', () => {
    const forms = ['+54 9 2622 517447', '5492622517447', '54 9 2622-517447', '+54 (9) 2622.517447', '542622517447', '54-2622-517447'];
    const keys = new Set(forms.map((form) => canonicalPhoneKey(form)));
    expect([...keys]).toEqual(['542622517447']);
  });

  it('matches the key the inbound handler derives for the same number', () => {
    const inbound = normalizeWhatsappSender('5492622517447@s.whatsapp.net');
    expect(canonicalPhoneKey('+54 9 2622 517447')).toBe(inbound?.key);
  });

  it('returns null for input that is not a WhatsApp number with a country code', () => {
    expect(canonicalPhoneKey('2622517447')).toBeNull();
    expect(canonicalPhoneKey('abc')).toBeNull();
    expect(canonicalPhoneKey('')).toBeNull();
    expect(canonicalPhoneKey('+1 555 0100')).toBeNull();
    expect(canonicalPhoneKey('54')).toBeNull();
  });
});
