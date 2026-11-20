import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { validatePlatformToken } from './service.js';

// Extend Express Request with the platform admin payload.
declare global {
  namespace Express {
    interface Request {
      platformAdmin?: {
        adminId: string;
        scope: 'platform';
        jti: string;
      };
    }
  }
}

/**
 * Validates a platform JWT and attaches `req.platformAdmin`.
 *
 * Deliberately does NOT require a `tenantId` and does NOT enter a tenant ALS
 * scope — platform requests operate on the master database.
 */
export const platformAuthenticate = async (
  request: Request,
  _response: Response,
  next: NextFunction
): Promise<void> => {
  const header = request.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError('Missing or malformed authorization header', 401));
    return;
  }

  const token = header.slice(7);

  try {
    const payload = await validatePlatformToken(token);
    request.platformAdmin = payload;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Invalid or expired token', 401));
    }
  }
};
