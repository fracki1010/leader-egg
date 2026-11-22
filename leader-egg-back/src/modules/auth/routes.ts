import { Router } from 'express';
import {
  changePasswordHandler,
  deleteUserHandler,
  listDriversHandler,
  listUsersHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
  updateUserRoleHandler
} from './controller.js';
import { authenticate, authorize, requirePermission } from './middleware.js';
import { loginRateLimiter } from './rate-limit.js';

export const authRouter = Router();

// Rate-limited: guards the public login endpoint against brute force. Only the
// login route is throttled — the rest of the API is untouched.
authRouter.post('/login', loginRateLimiter, loginHandler);
authRouter.get('/me', authenticate, meHandler);
authRouter.post('/logout', authenticate, logoutHandler);
// Self-service password change — every authenticated tenant role, no role guard.
authRouter.post('/change-password', authenticate, changePasswordHandler);
authRouter.post('/register', authenticate, authorize('admin'), requirePermission('users.manage'), registerHandler);

/**
 * User-facing routes (users resource). GET /drivers and GET / are declared
 * before the param route; DELETE /:id and PATCH /:id only match their own
 * methods, so they do not shadow the GET routes above them.
 */
export const usersRouter = Router();

usersRouter.get('/', authenticate, authorize('admin'), requirePermission('users.manage'), listUsersHandler);
usersRouter.get('/drivers', authenticate, authorize('admin'), requirePermission('users.manage'), listDriversHandler);
usersRouter.patch('/:id', authenticate, authorize('admin'), requirePermission('users.manage'), updateUserRoleHandler);
usersRouter.delete('/:id', authenticate, authorize('admin'), requirePermission('users.manage'), deleteUserHandler);
