import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `config/env.ts` validates at import time, so each case resets the module
 * registry and imports it again against a controlled process.env.
 */

const WHATSAPP_KEYS = [
  'WHATSAPP_ENABLED',
  'EVOLUTION_URL',
  'EVOLUTION_API_KEY',
  'WEBHOOK_SECRET',
  'WHATSAPP_WEBHOOK_BASE_URL',
  'GROQ_API_KEY',
  'GROQ_BASE_URL',
  'GROQ_TRANSCRIPTION_MODEL',
  'GROQ_VISION_MODEL',
  'WHATSAPP_ADMIN_ALLOWLIST'
] as const;

const VALID_SECRET = 'a'.repeat(32);

const enabledEnv = (): Record<string, string> => ({
  WHATSAPP_ENABLED: 'true',
  EVOLUTION_URL: 'http://evolution-api:8080',
  EVOLUTION_API_KEY: 'evolution-test-key',
  WEBHOOK_SECRET: VALID_SECRET,
  WHATSAPP_WEBHOOK_BASE_URL: 'http://api:3000/api/v1/whatsapp/webhook',
  GROQ_API_KEY: 'groq-test-key'
});

const loadEnv = async (overrides: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
  const { env } = await import('../config/env.js');
  return env;
};

describe('WhatsApp environment', () => {
  beforeEach(() => {
    for (const key of WHATSAPP_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of WHATSAPP_KEYS) {
      delete process.env[key];
    }
  });

  it('does not require any WhatsApp variable when the flag is off', async () => {
    const env = await loadEnv({});

    expect(env.WHATSAPP_ENABLED).toBe(false);
    expect(env.EVOLUTION_URL).toBeUndefined();
    expect(env.WEBHOOK_SECRET).toBeUndefined();
  });

  it('accepts a complete configuration when the flag is on', async () => {
    const env = await loadEnv(enabledEnv());

    expect(env.WHATSAPP_ENABLED).toBe(true);
    expect(env.EVOLUTION_URL).toBe('http://evolution-api:8080');
  });

  it('fails when enabled without EVOLUTION_URL', async () => {
    const { EVOLUTION_URL: _omit, ...rest } = enabledEnv();
    await expect(loadEnv(rest)).rejects.toThrow(/EVOLUTION_URL/);
  });

  it('fails when enabled with a WEBHOOK_SECRET shorter than 32 characters', async () => {
    await expect(loadEnv({ ...enabledEnv(), WEBHOOK_SECRET: 'a'.repeat(31) })).rejects.toThrow(
      /WEBHOOK_SECRET/
    );
  });

  it('fails when enabled without WEBHOOK_SECRET', async () => {
    const { WEBHOOK_SECRET: _omit, ...rest } = enabledEnv();
    await expect(loadEnv(rest)).rejects.toThrow(/WEBHOOK_SECRET/);
  });

  it.each(['EVOLUTION_API_KEY', 'WHATSAPP_WEBHOOK_BASE_URL', 'GROQ_API_KEY'])(
    'fails when enabled without %s',
    async (key) => {
      await expect(loadEnv({ ...enabledEnv(), [key]: '' })).rejects.toThrow(new RegExp(key));
    }
  );

  it('ignores WHATSAPP_ADMIN_ALLOWLIST (the whitelist lives in the tenant)', async () => {
    const env = await loadEnv({ ...enabledEnv(), WHATSAPP_ADMIN_ALLOWLIST: '5491112345678' });

    expect('WHATSAPP_ADMIN_ALLOWLIST' in env).toBe(false);
  });

  it('defaults the Groq media models to the verified ids', async () => {
    const env = await loadEnv({});

    expect(env.GROQ_BASE_URL).toBe('https://api.groq.com/openai/v1');
    expect(env.GROQ_TRANSCRIPTION_MODEL).toBe('whisper-large-v3-turbo');
    expect(env.GROQ_VISION_MODEL).toBe('qwen/qwen3.8-27b');
  });

  it('keeps the existing AGENT_* defaults unchanged', async () => {
    const env = await loadEnv({});

    expect(env.AGENT_MODEL).toBe('deepseek-chat');
    expect(env.AGENT_BASE_URL).toBe('https://api.deepseek.com/v1');
  });
});
