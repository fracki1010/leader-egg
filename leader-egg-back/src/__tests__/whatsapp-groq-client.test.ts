import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGroqClient, GROQ_TIMEOUT_MS } from '../modules/whatsapp/groq-client.js';

describe('Groq client timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a 30 second timeout by default', () => {
    expect(GROQ_TIMEOUT_MS).toBe(30_000);
  });

  it('aborts a request that exceeds the timeout with a fixed message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );

    const groq = createGroqClient({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'groq-secret-key',
      transcriptionModel: 'whisper-large-v3-turbo',
      timeoutMs: 20
    });

    await expect(groq.postJson('/chat/completions', { model: 'x' })).rejects.toMatchObject({
      status: 503,
      message: 'Media provider did not respond in time'
    });
  });
});
