import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { User } from '../auth/model.js';
import { chat, getChatState, clearChat } from './service.js';
import { cancelAction, confirmAction, getAction } from './actions.js';
import { chatMessageSchema } from './schema.js';

/** GET /v1/agent/chat — returns 200 even when disabled so the UI can show it. */
export const getChatHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const state = await getChatState(request.user!.userId);
    response.status(200).json(state);
  } catch (error) {
    next(error);
  }
};

/** POST /v1/agent/chat — one user turn through the assistant loop. */
export const postChatHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = chatMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((issue) => issue.message).join('; '), 400);
    }

    const user = request.user!;
    const dbUser = await User.findById(user.userId).select('name');
    const result = await chat(
      user.userId,
      dbUser?.name ?? 'Administrador',
      user.permissions ?? [],
      parsed.data.message
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/** DELETE /v1/agent/chat — clears the transcript, keeps the audit trail. */
export const deleteChatHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    await clearChat(request.user!.userId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

/** GET /v1/agent/actions/:id — the caller's own pending/resolved action. */
export const getActionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const action = await getAction(request.user!.userId, request.params.id as string);
    response.status(200).json({ action });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /v1/agent/actions/:id/confirm — executes the stored action exactly once.
 * The client sends ONLY the id: the payload lives server-side.
 */
export const confirmActionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const user = request.user!;
    const action = await confirmAction(
      user.userId,
      user.role,
      user.permissions ?? [],
      request.params.id as string
    );
    response.status(200).json({ action });
  } catch (error) {
    next(error);
  }
};

/** POST /v1/agent/actions/:id/cancel — only a pending action can be cancelled. */
export const cancelActionHandler = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    const action = await cancelAction(request.user!.userId, request.params.id as string);
    response.status(200).json({ action });
  } catch (error) {
    next(error);
  }
};
