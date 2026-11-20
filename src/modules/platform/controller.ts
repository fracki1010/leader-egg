import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middleware/error-handler.js';
import {
  changePlatformPassword,
  createPlatformUser,
  createTenant,
  deletePlatformUser,
  deleteTenant,
  getPlatformAdmin,
  getPlatformPuntoCero,
  listPlatformUsers,
  listTenants,
  platformLogin,
  resetPlatformTenant,
  resetPlatformUserPassword,
  setPlatformPuntoCero,
  updatePlatformUser,
  updateTenant
} from './service.js';
import {
  changePasswordSchema,
  createPlatformUserSchema,
  createTenantSchema,
  deletePlatformUserQuerySchema,
  deleteTenantSchema,
  listPlatformUsersQuerySchema,
  platformLoginSchema,
  platformSetPuntoCeroSchema,
  platformTenantResetSchema,
  resetPlatformUserPasswordSchema,
  updatePlatformUserSchema,
  updateTenantSchema
} from './schema.js';
import type { ITenant, IPlatformAdmin } from '../../tenancy/master-models.js';

/** Shared tenant serializer — never exposes internal Mongoose fields. */
const serializeTenant = (tenant: ITenant): Record<string, unknown> => ({
  id: String(tenant._id),
  name: tenant.name,
  slug: tenant.slug,
  dbName: tenant.dbName,
  active: tenant.active,
  plan: tenant.plan ?? null,
  createdAt: tenant.createdAt
});

/** Shared platform-admin serializer — never exposes the password hash. */
const serializeAdmin = (admin: IPlatformAdmin): Record<string, unknown> => ({
  id: String(admin._id),
  name: admin.name,
  email: admin.email
});

export const platformLoginHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = platformLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const { token, admin } = await platformLogin(parsed.data);

    response.status(200).json({
      token,
      admin: serializeAdmin(admin)
    });
  } catch (error) {
    next(error);
  }
};

export const platformMeHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const adminId = request.platformAdmin?.adminId;
    if (!adminId) {
      throw new AppError('Authentication required', 401);
    }

    const admin = await getPlatformAdmin(adminId);
    response.status(200).json({ admin: serializeAdmin(admin) });
  } catch (error) {
    next(error);
  }
};

export const changePasswordHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const adminId = request.platformAdmin?.adminId;
    if (!adminId) {
      throw new AppError('Authentication required', 401);
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    await changePlatformPassword(adminId, parsed.data);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const listTenantsHandler = async (
  _request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const tenants = await listTenants();
    response.status(200).json(tenants);
  } catch (error) {
    next(error);
  }
};

export const createTenantHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const tenant = await createTenant(parsed.data);
    response.status(201).json({ tenant: serializeTenant(tenant) });
  } catch (error) {
    next(error);
  }
};

export const updateTenantHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = updateTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const tenant = await updateTenant(id, parsed.data);
    response.status(200).json({ tenant: serializeTenant(tenant) });
  } catch (error) {
    next(error);
  }
};

export const deleteTenantHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = deleteTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    await deleteTenant(id, parsed.data.confirm);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

// ── Tenant data reset ────────────────────────────────────────────────────────

/** POST /v1/platform/tenants/:id/reset — clear a tenant's business data. */
export const resetTenantHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = platformTenantResetSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const result = await resetPlatformTenant(id, parsed.data);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// ── Platform-run punto cero ──────────────────────────────────────────────────
/** GET /v1/platform/tenants/:id/punto-cero — tenant setup state + references. */
export const getPlatformPuntoCeroHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const id = request.params.id as string;
    const view = await getPlatformPuntoCero(id);
    response.status(200).json(view);
  } catch (error) {
    next(error);
  }
};

/** POST /v1/platform/tenants/:id/punto-cero — run punto cero FOR the tenant. */
export const setPlatformPuntoCeroHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const adminId = request.platformAdmin?.adminId;
    if (!adminId) {
      throw new AppError('Authentication required', 401);
    }

    const parsed = platformSetPuntoCeroSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const view = await setPlatformPuntoCero(id, parsed.data, adminId);
    response.status(200).json(view);
  } catch (error) {
    next(error);
  }
};

// ── Platform-wide user management ────────────────────────────────────────────

export const listPlatformUsersHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = listPlatformUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const users = await listPlatformUsers({
      tenantId: parsed.data.tenant,
      search: parsed.data.search
    });
    response.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

export const createPlatformUserHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createPlatformUserSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const user = await createPlatformUser(parsed.data);
    response.status(201).json({ user });
  } catch (error) {
    next(error);
  }
};

export const updatePlatformUserHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = updatePlatformUserSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    const user = await updatePlatformUser(id, parsed.data);
    response.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const deletePlatformUserHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = deletePlatformUserQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    await deletePlatformUser(id, parsed.data.tenant);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const resetPlatformUserPasswordHandler = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = resetPlatformUserPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => i.message).join('; '), 400);
    }

    const id = request.params.id as string;
    await resetPlatformUserPassword(id, parsed.data);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
};
