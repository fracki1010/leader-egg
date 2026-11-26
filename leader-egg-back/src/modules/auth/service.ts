import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../middleware/error-handler.js';
import { env } from '../../config/env.js';
import { User, type IUser, type UserRole } from './model.js';
import { DEFAULT_PERMISSIONS_BY_ROLE, normalizePermissions } from './permissions.js';
import { Route } from '../routes/model.js';
import type { ChangePasswordInput, LoginInput, RegisterInput, UpdateUserRoleInput } from './schema.js';
import { getBlacklist } from './blacklist.js';
import { EmailIndex } from '../../tenancy/master-models.js';
import { getTenantConnection } from '../../tenancy/registry.js';
import { getTenancy, runWithTenancy } from '../../tenancy/context.js';
import { getTenantFromCache, refreshTenantCache, type TenantRecord } from '../../tenancy/tenants.js';
import { removeUserWhatsappLinks } from '../whatsapp/team-phone.js';

interface TokenPayload {
  userId: string;
  role: string;
  tenantId?: string;
  jti: string;
  /**
   * Session generation (`tokenVersion` at signing time). Tokens without it are
   * legacy tokens and are treated as version 0.
   */
  tv?: number;
}

/** The login response: token + user + the tenant that owns the account. */
export interface LoginResult {
  token: string;
  user: IUser;
  tenant: { id: string; name: string; slug: string };
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

const signToken = (user: IUser, tenantId: string): string => {
  const jti = randomUUID();
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, tenantId, jti, tv: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    { audience: 'tenant', expiresIn: env.JWT_EXPIRES_IN as StringValue }
  );
};

/**
 * Resolves a tenant record by id, refreshing the in-memory cache once on a miss.
 * Fails closed (generic 401) when the tenant cannot be found.
 */
const resolveTenant = async (tenantId: string): Promise<TenantRecord> => {
  let tenant = getTenantFromCache(tenantId);
  if (!tenant) {
    await refreshTenantCache();
    tenant = getTenantFromCache(tenantId);
  }
  if (!tenant) {
    throw new AppError('Invalid credentials', 401);
  }
  return tenant;
};

/**
 * Registers a user INSIDE the current tenant (the route runs behind
 * `authenticate`, so a tenant ALS context is guaranteed).
 *
 * The platform-wide `EmailIndex` (master DB) is maintained after the user is
 * created — it needs the real userId. A unique-key violation on the index
 * (409) triggers a compensating delete of the just-created user.
 */
export const register = async (input: RegisterInput): Promise<IUser> => {
  const tenancy = getTenancy();
  if (!tenancy?.tenantId) {
    throw new AppError('Registration requires a tenant context', 500);
  }
  const tenantId = tenancy.tenantId;
  const email = input.email.trim().toLowerCase();

  // Fail fast for a platform-wide duplicate (the unique index is the backstop).
  const existingIndex = await EmailIndex.findOne({ email });
  if (existingIndex) {
    throw new AppError('Email already registered', 409);
  }

  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError('Email already registered', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  // Admin creation defaults to the full permission set; non-admin roles never
  // receive module permissions (their flows are governed by role guards).
  const permissions =
    input.role === 'admin'
      ? input.permissions !== undefined
        ? normalizePermissions(input.permissions)
        : [...DEFAULT_PERMISSIONS_BY_ROLE.admin]
      : [];
  const user = await User.create({
    name: input.name,
    email,
    passwordHash,
    role: input.role,
    permissions
  });

  try {
    await EmailIndex.create({ email, tenantId, userId: user._id });
  } catch (error) {
    // Compensating rollback — never leave an orphaned tenant user behind.
    await user.deleteOne();
    if (isDuplicateKeyError(error)) {
      throw new AppError('Email already registered', 409);
    }
    throw error;
  }

  return user;
};

/**
 * Tenant-aware login.
 *
 *  1. route the email through the platform-wide `EmailIndex` (master DB)
 *  2. resolve the tenant (cache → connection); reject suspended tenants (403)
 *  3. look up the user + verify the password inside the tenant's database
 *  4. sign a JWT carrying `{ userId, role, tenantId, jti }`
 *
 * Unknown email and wrong password both return a generic 401 (no existence leak).
 */
export const login = async (input: LoginInput): Promise<LoginResult> => {
  const email = input.email.trim().toLowerCase();

  const index = await EmailIndex.findOne({ email });
  if (!index) {
    throw new AppError('Invalid credentials', 401);
  }

  const tenant = await resolveTenant(String(index.tenantId));
  if (!tenant.active) {
    throw new AppError('Tenant is suspended', 403);
  }

  const connection = getTenantConnection(tenant.dbName);
  const user = await runWithTenancy({ connection, tenantId: tenant.id }, () =>
    User.findOne({ email })
  );
  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  const isValid = await bcrypt.compare(input.password, user.passwordHash);
  if (!isValid) {
    throw new AppError('Invalid credentials', 401);
  }

  const token = signToken(user, tenant.id);
  return {
    token,
    user,
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }
  };
};

/**
 * Self-service password change for the authenticated tenant user.
 *
 * Verifies the current password before writing. Rejects reusing the same
 * password with 400. On success the hash is replaced, `tokenVersion` is bumped
 * (invalidating every previously issued token) and a FRESH token is returned so
 * the caller's current session survives the rotation.
 */
export const changePassword = async (
  userId: string,
  tenantId: string,
  input: { currentPassword: string; newPassword: string }
): Promise<{ token: string }> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!isValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  if (input.newPassword === input.currentPassword) {
    throw new AppError('New password must be different from the current password', 400);
  }

  user.passwordHash = await bcrypt.hash(input.newPassword, 10);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  return { token: signToken(user, tenantId) };
};

export const logout = async (token: string): Promise<void> => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { complete: true });
    const payload = decoded.payload as TokenPayload & { exp: number };
    const ttl = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
    if (ttl > 0) {
      await getBlacklist().add(payload.jti, ttl);
    }
  } catch {
    // Token is invalid/expired — nothing to revoke
  }
};

export const validateToken = async (token: string): Promise<TokenPayload> => {
  // Only tenant-audience tokens are accepted here; a platform token (signed
  // with the platform secret for the `platform` audience) fails verification.
  const decoded = jwt.verify(token, env.JWT_SECRET, { audience: 'tenant' }) as TokenPayload;

  if (await getBlacklist().has(decoded.jti)) {
    throw new AppError('Token has been revoked', 401);
  }

  return decoded;
};

export const isRevoked = async (jti: string): Promise<boolean> => {
  return getBlacklist().has(jti);
};

/**
 * List users with role 'driver', sorted by name ascending.
 * Only exposes _id, name and email.
 */
export const listDrivers = async (): Promise<IUser[]> => {
  return User.find({ role: 'driver' }).select('_id name email').sort({ name: 1 });
};

/**
 * List ALL users (admin only), sorted by name ascending.
 * Exposes _id, name, email, role, permissions and createdAt.
 */
export const listUsers = async (): Promise<IUser[]> => {
  return User.find().select('_id name email role permissions createdAt').sort({ name: 1 });
};

/**
 * Returns the authenticated user's current profile. Used by the frontend to
 * refresh role/permissions on boot so a permission change does not require a
 * fresh login (the backend already revalidates on every request).
 */
export const getCurrentUser = async (id: string): Promise<IUser> => {
  const user = await User.findById(id).select('_id name email role permissions');
  if (!user) {
    throw new AppError('User not found', 401);
  }
  return user;
};

/**
 * Delete a user. Guards:
 * - 404 when the user does not exist
 * - 409 when deleting your own account (self-delete protection)
 * - 409 when the user still has routes assigned (keeps audit/assignment integrity)
 */
export const deleteUser = async (id: string, currentUserId: string): Promise<void> => {
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user._id.toString() === currentUserId) {
    throw new AppError('You cannot delete your own user', 409);
  }

  const assignedRoutes = await Route.countDocuments({ driverId: id });
  if (assignedRoutes > 0) {
    throw new AppError('Cannot delete user with assigned routes', 409);
  }

  await user.deleteOne();
  // A number linked to a deleted user must stop being answered as that user.
  await removeUserWhatsappLinks(String(user._id));
  // Keep the platform-wide email index consistent with the tenant DB. Scope the
  // delete to the caller's tenant as defense in depth (the ALS context is set
  // by `authenticate` for every tenant route).
  const tenantId = getTenancy()?.tenantId;
  await EmailIndex.deleteMany(tenantId ? { userId: user._id, tenantId } : { userId: user._id });
};

const isAdminRole = (role: UserRole): boolean => role === 'admin' || role === 'superadmin';

/**
 * Counts the OTHER users who would still be able to manage users after a change.
 * A superadmin always has access (it bypasses the permission check), so it counts
 * as a remaining access provider even without an explicit `users.manage`.
 */
const countRemainingUserManagers = async (excludeId: string): Promise<number> => {
  const remaining = await User.countDocuments({
    _id: { $ne: excludeId },
    $or: [{ role: 'superadmin' }, { role: 'admin', permissions: 'users.manage' }]
  });
  return remaining;
};

/**
 * Updates a user's role and/or permissions (admin only). Guards:
 * - 404 when the user does not exist
 * - 409 when trying to change your own role (self-demotion protection —
 *   an admin must not be able to strip their own role)
 * - 409 when the change would remove `users.manage` from the last admin able to
 *   use it, leaving the tenant without any user manager
 *
 * Non-admin roles never keep module permissions (normalized to []). When an
 * admin is promoted/changed without an explicit permission list, the role default
 * is applied.
 */
export const updateUserRole = async (
  id: string,
  input: UpdateUserRoleInput,
  currentUserId: string
): Promise<IUser> => {
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user._id.toString() === currentUserId && input.role !== undefined && input.role !== user.role) {
    throw new AppError('You cannot change your own role', 409);
  }

  const currentPermissions = user.permissions ?? [];
  const targetRole: UserRole = input.role ?? user.role;
  const targetIsAdmin = isAdminRole(targetRole);

  let targetPermissions: string[];
  if (!targetIsAdmin) {
    targetPermissions = [];
  } else if (input.permissions !== undefined) {
    targetPermissions = normalizePermissions(input.permissions);
  } else if (input.role !== undefined && input.role !== user.role) {
    targetPermissions = [...DEFAULT_PERMISSIONS_BY_ROLE[targetRole]];
  } else {
    targetPermissions = currentPermissions;
  }

  const losesUserManagement =
    isAdminRole(user.role) &&
    currentPermissions.includes('users.manage') &&
    !(targetIsAdmin && targetPermissions.includes('users.manage'));

  if (losesUserManagement) {
    const remaining = await countRemainingUserManagers(user._id.toString());
    if (remaining === 0) {
      throw new AppError('At least one admin must keep user management permission', 409);
    }
  }

  user.role = targetRole;
  user.permissions = targetPermissions;
  await user.save();

  return user;
};
