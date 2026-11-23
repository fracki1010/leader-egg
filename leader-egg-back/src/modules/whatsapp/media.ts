import { AppError } from '../../middleware/error-handler.js';
import { env } from '../../config/env.js';
import { createGroqClient } from './groq-client.js';
import { getEvolutionClient, type EvolutionMessageKey } from './evolution-client.js';

/** Groq's upload limit for audio files. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_AUDIO_BYTES * 4) / 3);

/**
 * Downloads a voice note from the provider and returns its transcription.
 *
 * Throws a fixed AppError when the media is unavailable, too large, not audio, or
 * the transcription provider is not configured; the caller turns that into a reply.
 */
export const transcribeAudio = async (
  instanceName: string,
  key: EvolutionMessageKey
): Promise<string> => {
  if (!env.GROQ_API_KEY) {
    throw new AppError('Transcription is not configured', 503);
  }

  const payload = await getEvolutionClient().getBase64FromMedia(instanceName, key);
  const { base64, mimetype } = payload as { base64?: unknown; mimetype?: unknown };
  if (typeof base64 !== 'string' || base64 === '') {
    throw new AppError('Media unavailable', 502);
  }
  if (base64.length > MAX_BASE64_LENGTH) {
    throw new AppError('Audio too large', 413);
  }

  const mimeType = typeof mimetype === 'string' ? mimetype : 'audio/ogg';
  if (!mimeType.startsWith('audio/')) {
    throw new AppError('Unsupported media', 415);
  }

  const groq = createGroqClient({
    baseUrl: env.GROQ_BASE_URL,
    apiKey: env.GROQ_API_KEY,
    transcriptionModel: env.GROQ_TRANSCRIPTION_MODEL
  });
  return groq.transcribe(Buffer.from(base64, 'base64'), mimeType);
};
