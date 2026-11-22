import { z } from 'zod';

export const chatMessageSchema = z.object({
  message: z.string().trim().min(1, 'El mensaje no puede estar vacío').max(2000, 'El mensaje es demasiado largo')
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
