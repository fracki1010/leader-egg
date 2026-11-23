import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The WhatsApp chat a turn runs in, when it runs in one.
 *
 * A pending action remembers the chat that prepared it, so a "sí" or "no" from
 * another chat (or from the app, which has no chat) cannot confirm or cancel it.
 */
const als = new AsyncLocalStorage<{ whatsappChatId: string }>();

export const runInWhatsappChat = <T>(whatsappChatId: string, fn: () => Promise<T>): Promise<T> =>
  als.run({ whatsappChatId }, fn);

/** The WhatsApp chat of the current turn, or null outside WhatsApp. */
export const currentWhatsappChat = (): string | null => als.getStore()?.whatsappChatId ?? null;
