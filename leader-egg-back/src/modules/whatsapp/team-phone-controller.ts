import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../middleware/error-handler.js';
import { setUserWhatsappPhone } from './team-phone.js';

const setPhoneSchema = z.object({
  phone: z.string().max(40).nullable()
});

/** PUT /v1/users/:id/whatsapp-phone — admin only (guarded by the route). */
export const setUserWhatsappPhoneHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = setPhoneSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const phone = await setUserWhatsappPhone(request.params.id as string, parsed.data.phone);
    response.json({ phone });
  } catch (error) {
    next(error);
  }
};
