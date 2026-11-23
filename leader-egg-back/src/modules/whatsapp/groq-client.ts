import { AppError } from '../../middleware/error-handler.js';

/**
 * Groq client for the WhatsApp media steps (transcription and vision).
 *
 * Error messages are fixed strings so the key and provider bodies never leak.
 */

export const GROQ_TIMEOUT_MS = 30_000;

const MESSAGES = {
  timeout: 'Media provider did not respond in time',
  unreachable: 'Media provider is unreachable',
  failed: 'Media provider returned an error'
} as const;

export interface GroqClientConfig {
  baseUrl: string;
  apiKey: string;
  transcriptionModel: string;
  timeoutMs?: number;
}

export interface GroqClient {
  postJson(path: string, body: unknown): Promise<unknown>;
  /** Audio bytes to the transcription text. */
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}

export const createGroqClient = (config: GroqClientConfig): GroqClient => {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? GROQ_TIMEOUT_MS;

  /** One request with a timeout that also covers the body read; fixed errors only. */
  const send = async (path: string, init: RequestInit): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.apiKey}`, ...init.headers },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AppError(MESSAGES.failed, 503);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(controller.signal.aborted ? MESSAGES.timeout : MESSAGES.unreachable, 503);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    postJson(path, body) {
      return send(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    },

    async transcribe(audio, mimeType) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'audio');
      form.append('model', config.transcriptionModel);

      const payload = (await send('/audio/transcriptions', { method: 'POST', body: form })) as {
        text?: unknown;
      };
      if (typeof payload.text !== 'string') {
        throw new AppError(MESSAGES.failed, 503);
      }
      return payload.text;
    }
  };
};
