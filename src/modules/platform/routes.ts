import { Router } from 'express';
import {
  changePasswordHandler,
  createPlatformUserHandler,
  createTenantHandler,
  deletePlatformUserHandler,
  deleteTenantHandler,
  getPlatformPuntoCeroHandler,
  listPlatformUsersHandler,
  listTenantsHandler,
  platformLoginHandler,
  platformMeHandler,
  resetPlatformUserPasswordHandler,
  resetTenantHandler,
  setPlatformPuntoCeroHandler,
  updatePlatformUserHandler,
  updateTenantHandler
} from './controller.js';
import { platformAuthenticate } from './middleware.js';
import { platformLoginRateLimiter } from '../auth/rate-limit.js';

/**
 * Platform (super-tenant) router, mounted at `/v1/platform`.
 *
 * `POST /auth/login` is public and rate-limited; every other route requires a
 * platform token (`scope === 'platform'`). None of these routes enter a tenant
 * ALS scope.
 */
export const platformRouter = Router();

platformRouter.post('/auth/login', platformLoginRateLimiter, platformLoginHandler);

platformRouter.use(platformAuthenticate);
platformRouter.get('/me', platformMeHandler);
platformRouter.patch('/me/password', changePasswordHandler);
platformRouter.get('/tenants', listTenantsHandler);
platformRouter.post('/tenants', createTenantHandler);
platformRouter.patch('/tenants/:id', updateTenantHandler);
platformRouter.delete('/tenants/:id', deleteTenantHandler);

// Clear a tenant's business data (platform/super admin only, slug-confirmed).
platformRouter.post('/tenants/:id/reset', resetTenantHandler);

// Run the full punto cero FOR a specific tenant (platform/super admin only).
platformRouter.get('/tenants/:id/punto-cero', getPlatformPuntoCeroHandler);
platformRouter.post('/tenants/:id/punto-cero', setPlatformPuntoCeroHandler);

// Platform-wide user management (all tenants).
platformRouter.get('/users', listPlatformUsersHandler);
platformRouter.post('/users', createPlatformUserHandler);
platformRouter.patch('/users/:id', updatePlatformUserHandler);
platformRouter.delete('/users/:id', deletePlatformUserHandler);
platformRouter.post('/users/:id/reset-password', resetPlatformUserPasswordHandler);
