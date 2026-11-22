import { z } from 'zod';
import { isPermission } from './permissions.js';

/** A permission list where every entry must exist in the catalog. */
const permissionListSchema = z
  .array(z.string())
  .refine((values) => values.every((value) => isPermission(value)), {
    message: 'Unknown permission'
  });

export const loginSchema = z.object({
  email: z.string().trim().min(1).email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().min(1).email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  // Tenant roles only — the legacy `superadmin` role is retired for new users.
  role: z.enum(['admin', 'driver', 'puesto', 'viewer']),
  // Only meaningful for admins; non-admin roles are normalized to [].
  permissions: permissionListSchema.optional()
});

/** Body for PATCH /v1/users/:id — role and/or permissions (admin). */
export const updateUserRoleSchema = z
  .object({
    role: z.enum(['admin', 'driver', 'puesto', 'viewer']).optional(),
    permissions: permissionListSchema.optional()
  })
  .refine((value) => value.role !== undefined || value.permissions !== undefined, {
    message: 'Provide at least one of: role, permissions'
  });

/** Body for POST /v1/auth/change-password — self-service password change. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
