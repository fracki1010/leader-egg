import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import { validateToken } from './service.js';
import { User, type UserRole } from './model.js';
import { hasPermission } from './permissions.js';
import { getTenantFromCache, refreshTenantCache } from '../../tenancy/tenants.js';
import { getTenantConnection } from '../../tenancy/registry.js';
import { runWithTenancy } from '../../tenancy/context.js';

// Extend Express Request to include auth payload
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
        /** Resolved per-module permissions (admins only). */
        permissions?: string[];
        /** Tenant the token belongs to. Required on every tenant token. */
        tenantId?: string;
        jti: string;
      };
    }
  }
}

/**
 * Extracts and validates a tenant JWT from the Authorization header.
 *
 * Beyond signature + blacklist validation, a tenant token MUST carry `tenantId`
 * (tokens without it fail closed with 401). The tenant is resolved from the
 * in-memory cache (refreshed once on a miss) and the ENTIRE downstream request
 * (controllers/services) runs inside `runWithTenancy(...)`, so every scoped
 * model access hits the tenant's own database.
 *
 *  - missing `tenantId`     → 401
 *  - unknown tenant         → 401
 *  - suspended (inactive)   → 403
 */
export const authenticate = async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
  const header = request.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError('Missing or malformed authorization header', 401));
    return;
  }

  const token = header.slice(7);

  try {
    const payload = await validateToken(token);
    request.user = payload;

    const tenantId = payload.tenantId;
    if (!tenantId) {
      next(new AppError('Token is not bound to a tenant', 401));
      return;
    }

    let tenant = getTenantFromCache(tenantId);
    if (!tenant) {
      await refreshTenantCache();
      tenant = getTenantFromCache(tenantId);
    }
    if (!tenant) {
      next(new AppError('Tenant not found', 401));
      return;
    }
    if (!tenant.active) {
      next(new AppError('Tenant is suspended', 403));
      return;
    }

    const connection = getTenantConnection(tenant.dbName);
    // The ALS scope must cover the whole downstream request, hence `next()`
    // is invoked inside the tenancy context (not called after it returns).
    // The user is reloaded on EVERY request so role/permission changes take
    // effect immediately, even if the JWT still carries the old role.
    await runWithTenancy({ connection, tenantId }, async () => {
      const dbUser = await User.findById(payload.userId).select('role permissions tokenVersion');
      if (!dbUser) {
        next(new AppError('Unauthorized', 401));
        return;
      }

      // Session invalidation: a password change (self-service or platform reset)
      // bumps `tokenVersion`, so every token signed before it is rejected. Legacy
      // tokens carry no `tv` and unmodified users hydrate `tokenVersion` as 0,
      // so old sessions stay valid until the first password change.
      if ((payload.tv ?? 0) !== (dbUser.tokenVersion ?? 0)) {
        next(new AppError('Session expired, please log in again', 401));
        return;
      }

      request.user = {
        ...payload,
        role: dbUser.role,
        permissions: dbUser.permissions ?? []
      };
      next();
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Invalid or expired token', 401));
    }
  }
};

/**
 * Checks that the authenticated user has one of the allowed roles.
 * Must be used after `authenticate`.
 *
 * Superadmin satisfies any `admin` requirement (and its own), so existing
 * admin-only routes keep working for legacy superadmin accounts without
 * touching them. The tenant `superadmin` role is retired for NEW users, but
 * the value stays readable so pre-existing data does not break.
 */
export const authorize = (...roles: UserRole[]) => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    const userRole = request.user.role as UserRole;
    const allowed = roles.includes(userRole) || (userRole === 'superadmin' && roles.includes('admin'));

    if (!allowed) {
      next(new AppError('Insufficient permissions', 403));
      return;
    }

    next();
  };
};

/**
 * Enforces a per-module permission for admin-class users.
 * Must be used after `authenticate` (and normally after `authorize`).
 *
 * Layering:
 *  - `authorize(...roles)` decides WHO reaches the route (admin vs driver/puesto).
 *  - `requirePermission(...)` decides WHICH modules an admin can use.
 *  - superadmin always bypasses (legacy accounts keep full access).
 *  - non-admin roles bypass too: their flows are already governed by role guards,
 *    so adding module permissions never breaks driver/puesto behaviour.
 */
export const requirePermission = (permission: string) => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    if (request.user.role === 'superadmin') {
      next();
      return;
    }

    if (request.user.role !== 'admin') {
      next();
      return;
    }

    const granted = request.user.permissions ?? [];
    if (hasPermission(granted, permission)) {
      next();
      return;
    }

    next(new AppError('Insufficient permissions', 403));
  };
};
