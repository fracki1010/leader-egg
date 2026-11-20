import { Router } from 'express';
import { authenticate, authorize } from '../auth/middleware.js';
import {
  getChatHandler,
  postChatHandler,
  deleteChatHandler,
  getActionHandler,
  confirmActionHandler,
  cancelActionHandler
} from './controller.js';

export const agentRouter = Router();

// The assistant is admin-only. Individual tools are additionally permission-
// checked per call (see tools.ts), so an admin without a module permission can
// still chat but will get a clear denial for that specific topic.
agentRouter.use(authenticate);
agentRouter.use(authorize('admin'));

agentRouter.get('/chat', getChatHandler);
agentRouter.post('/chat', postChatHandler);
agentRouter.delete('/chat', deleteChatHandler);

// Prepare → confirm: reads an action or executes/cancels it on explicit request.
agentRouter.get('/actions/:id', getActionHandler);
agentRouter.post('/actions/:id/confirm', confirmActionHandler);
agentRouter.post('/actions/:id/cancel', cancelActionHandler);
