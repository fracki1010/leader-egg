import { AppError } from '../../middleware/error-handler.js';

/**
 * Groq client for the WhatsApp media steps (transcription and vision).
 *
 * Skeleton for slice a: only the JSON POST path and its timeout are modelled.
 * Multipart transcription and vision requests are added with the media slice.
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
  timeoutMs?: number;
}

export interface GroqClient {
  postJson(path: string, body: unknown): Promise<unknown>;
}

export const createGroqClient = (config: GroqClientConfig): GroqClient => {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? GROQ_TIMEOUT_MS;

  return {
    async postJson(path, body) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // The timer covers the body read too, so a stalled response cannot hang.
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new AppError(MESSAGES.failed, 503);
        }

        return await response.json();
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          controller.signal.aborted ? MESSAGES.timeout : MESSAGES.unreachable,
          503
        );
      } finally {
        clearTimeout(timer);
      }
    }
  };
};
