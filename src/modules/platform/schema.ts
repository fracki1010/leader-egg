import { z } from 'zod';
import { setPuntoCeroSchema } from '../config/schema.js';
import { isPermission } from '../auth/permissions.js';

/** A permission list where every entry must exist in the catalog. */
const permissionListSchema = z
  .array(z.string())
  .refine((values) => values.every((value) => isPermission(value)), {
    message: 'Unknown permission'
  });

/** Body for POST /v1/platform/auth/login. */
export const platformLoginSchema = z.object({
  email: z.string().trim().min(1).email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

/** Body for POST /v1/platform/tenants — provisions a new tenant. */
export const createTenantSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: z.string().trim().min(1, 'Slug is required').max(60),
  adminName: z.string().trim().min(2).max(100),
  adminEmail: z.string().trim().min(1).email('Invalid email address'),
  adminPassword: z.string().min(6, 'Password must be at least 6 characters'),
  plan: z.string().trim().min(1).max(60).optional()
});

/**
 * Body for PATCH /v1/platform/tenants/:id.
 * `dbName` and `slug` are immutable and therefore not accepted.
 */
export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional()
  })
  .refine((value) => value.name !== undefined || value.active !== undefined, {
    message: 'Provide at least one of: name, active'
  });

/** Body for DELETE /v1/platform/tenants/:id — explicit deletion guard. */
export const deleteTenantSchema = z.object({
  confirm: z.string().min(1, 'Confirmation slug is required')
});

/**
 * Body for POST /v1/platform/tenants/:id/reset — destructive tenant-data reset.
 * `confirm` must equal the tenant slug; `zeroCustomerDebt` defaults to false so
 * customer opening debts survive unless the admin explicitly opts in.
 */
export const platformTenantResetSchema = z.object({
  confirm: z.string().min(1, 'Confirmation slug is required'),
  zeroCustomerDebt: z.boolean().optional()
});

/** Body for PATCH /v1/platform/me/password — self-service password change. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

// ── Platform-run punto cero ─────────────────────────────────────────────────

/**
 * Body for POST /v1/platform/tenants/:id/punto-cero.
 *
 * Reuses the tenant punto-cero payload unchanged and adds `force`, the platform
 * only escape hatch that allows re-running an already-finalized setup as an
 * explicit reset/correction.
 */
export const platformSetPuntoCeroSchema = setPuntoCeroSchema.extend({
  force: z.boolean().optional()
});

// ── Platform user management ─────────────────────────────────────────────────

/**
 * Roles a platform admin can assign to a tenant user. Mirrors the tenant
 * `registerSchema` role set — the legacy `superadmin` role is retired for new
 * users but may still exist on legacy tenant #1 data (read-only in the list).
 */
export const platformUserRoleSchema = z.enum(['admin', 'driver', 'puesto', 'viewer']);

/** Query for GET /v1/platform/users — optional tenant filter + search. */
export const listPlatformUsersQuerySchema = z.object({
  tenant: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional()
});

/** Body for POST /v1/platform/users — create a user in a specific tenant. */
export const createPlatformUserSchema = z.object({
  tenantId: z.string().trim().min(1, 'tenantId is required'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().min(1).email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: platformUserRoleSchema,
  // Only meaningful for admins; non-admin roles are normalized to [].
  permissions: permissionListSchema.optional()
});

/**
 * Body for PATCH /v1/platform/users/:id — the target user's tenant is required
 * (a user id is only unique within its own tenant database).
 */
export const updatePlatformUserSchema = z
  .object({
    tenantId: z.string().trim().min(1, 'tenantId is required'),
    name: z.string().trim().min(2).max(100).optional(),
    role: platformUserRoleSchema.optional(),
    permissions: permissionListSchema.optional()
  })
  .refine(
    (value) =>
      value.name !== undefined || value.role !== undefined || value.permissions !== undefined,
    { message: 'Provide at least one of: name, role, permissions' }
  );

/** Query for DELETE /v1/platform/users/:id — the owning tenant is required. */
export const deletePlatformUserQuerySchema = z.object({
  tenant: z.string().trim().min(1, 'tenant query parameter is required')
});

/** Body for POST /v1/platform/users/:id/reset-password. */
export const resetPlatformUserPasswordSchema = z.object({
  tenantId: z.string().trim().min(1, 'tenantId is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type DeleteTenantInput = z.infer<typeof deleteTenantSchema>;
export type PlatformTenantResetInput = z.infer<typeof platformTenantResetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type PlatformSetPuntoCeroInput = z.infer<typeof platformSetPuntoCeroSchema>;
export type ListPlatformUsersInput = z.infer<typeof listPlatformUsersQuerySchema>;
export type CreatePlatformUserInput = z.infer<typeof createPlatformUserSchema>;
export type UpdatePlatformUserInput = z.infer<typeof updatePlatformUserSchema>;
export type DeletePlatformUserInput = z.infer<typeof deletePlatformUserQuerySchema>;
export type ResetPlatformUserPasswordInput = z.infer<typeof resetPlatformUserPasswordSchema>;
