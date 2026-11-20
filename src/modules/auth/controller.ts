import type { NextFunction, Request, Response } from 'express';
import { changePassword, deleteUser, getCurrentUser, listDrivers, listUsers, login, logout, register, updateUserRole } from './service.js';
import { changePasswordSchema, loginSchema, registerSchema, updateUserRoleSchema } from './schema.js';
import { AppError } from '../../middleware/error-handler.js';

export const loginHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const { token, user, tenant } = await login(parsed.data);

    response.status(200).json({
      token,
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions ?? []
      },
      // Additive: existing frontend consumers keep reading `{ token, user }`.
      tenant
    });
  } catch (error) {
    next(error);
  }
};

export const meHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    if (!request.user) {
      throw new AppError('Authentication required', 401);
    }
    const user = await getCurrentUser(request.user.userId);
    response.status(200).json({
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions ?? []
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logoutHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      await logout(header.slice(7));
    }
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * POST /v1/auth/change-password — the authenticated user changes their own
 * password. No role guard: every tenant role may rotate its own credentials.
 * Returns a freshly signed token because the change invalidates all previous
 * tokens (including the one used for this request).
 */
export const changePasswordHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = request.user?.userId;
    const tenantId = request.user?.tenantId;
    if (!userId || !tenantId) {
      throw new AppError('Authentication required', 401);
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const { token } = await changePassword(userId, tenantId, parsed.data);
    response.status(200).json({ token });
  } catch (error) {
    next(error);
  }
};

export const registerHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const user = await register(parsed.data);

    response.status(201).json({
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions ?? []
      }
    });
  } catch (error) {
    next(error);
  }
};

export const listDriversHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const drivers = await listDrivers();
    response.status(200).json(
      drivers.map((driver) => ({
        _id: driver._id.toString(),
        name: driver.name,
        email: driver.email
      }))
    );
  } catch (error) {
    next(error);
  }
};

export const listUsersHandler = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await listUsers();
    response.status(200).json(
      users.map((user) => ({
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions ?? [],
        createdAt: user.createdAt
      }))
    );
  } catch (error) {
    next(error);
  }
};

export const deleteUserHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const currentUserId = request.user?.userId;
    if (!currentUserId) {
      throw new AppError('Authentication required', 401);
    }

    const id = request.params.id as string;
    await deleteUser(id, currentUserId);

    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const updateUserRoleHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const currentUserId = request.user?.userId;
    if (!currentUserId) {
      throw new AppError('Authentication required', 401);
    }

    const parsed = updateUserRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map(i => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const user = await updateUserRole(id, parsed.data, currentUserId);

    response.status(200).json({
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions ?? [],
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
};
