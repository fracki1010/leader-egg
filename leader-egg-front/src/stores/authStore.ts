import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import { switchOfflineNamespace } from '../lib/offline-db.ts';
import { hasPermission as permissionGranted } from '../lib/permissions.ts';
import type { AuthUser, ChangePasswordRequest, LoginRequest, Tenant, UserRole } from '../types/index.ts';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** Company the session belongs to. Null for legacy sessions cached before
   *  multi-tenancy (the backend omitted it) or when logged out. */
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Change the signed-in user's own password. The backend invalidates every
   * previous token, so the freshly returned one replaces the stored token.
   */
  changePassword: (payload: ChangePasswordRequest) => Promise<void>;
  /** Refresh the cached profile (role + permissions) from GET /v1/auth/me. */
  refreshSession: () => Promise<void>;
  clearError: () => void;
  hasRole: (role: UserRole) => boolean;
  /** Module-permission check for the current user (superadmin always passes). */
  hasPermission: (permission: string) => boolean;
}

/** Normalize a user payload so legacy responses without permissions are safe. */
const normalizeUser = (user: AuthUser): AuthUser => ({
  ...user,
  permissions: user.permissions ?? []
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      tenant: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (credentials: LoginRequest) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.login(credentials);
          // Point the offline cache/queue at this tenant's namespace BEFORE the
          // session is published, so no query or queued write can cross tenants.
          switchOfflineNamespace(response.tenant?.id ?? null);
          set({
            token: response.token,
            user: normalizeUser(response.user),
            // Older backends omit `tenant`; fall back to null instead of crashing.
            tenant: response.tenant ?? null,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // Logout API may fail (e.g., token already invalid) — clear local state anyway
        } finally {
          // Switch back to the legacy namespace so the logged-out session never
          // keeps reading the previous tenant's offline data. The tenant's own
          // cache is left untouched and restored on the next login.
          switchOfflineNamespace(null);
          set({
            token: null,
            user: null,
            tenant: null,
            isAuthenticated: false,
            error: null
          });
        }
      },

      changePassword: async (payload: ChangePasswordRequest) => {
        // The backend rotates the token version, so the token used for this
        // request is already invalid. Persist the replacement immediately.
        const { token } = await authApi.changePassword(payload);
        set({ token });
      },

      refreshSession: async () => {
        const { isAuthenticated, token } = get();
        if (!isAuthenticated || !token) return;

        try {
          const { user } = await authApi.me();
          set({ user: normalizeUser(user) });
        } catch (err) {
          // 401/403 → the token or user is invalid: drop the session locally
          // (never call the logout API here). Network/offline failures keep the
          // cached session so the app keeps working offline.
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            switchOfflineNamespace(null);
            set({
              token: null,
              user: null,
              tenant: null,
              isAuthenticated: false,
              error: null
            });
          }
        }
      },

      clearError: () => set({ error: null }),

      hasRole: (role: UserRole) => {
        const { user } = get();
        if (!user) return false;
        // Admin and superadmin have access to everything
        if (user.role === 'admin' || user.role === 'superadmin') return true;
        return user.role === role;
      },

      hasPermission: (permission: string) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'superadmin') return true;
        // Module permissions only apply to admins; every other role is
        // governed by role guards on the backend.
        if (user.role !== 'admin') return false;
        return permissionGranted(user.permissions ?? [], permission);
      }
    }),
    {
      name: 'auth-storage',
      version: 1,
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        tenant: state.tenant,
        isAuthenticated: state.isAuthenticated
      }),
      migrate: (persistedState, _version) => {
        const state = persistedState as Partial<AuthState> | undefined;
        if (!state || typeof state !== 'object' || !state.user) {
          return state as AuthState;
        }
        return {
          ...state,
          user: normalizeUser(state.user)
        } as AuthState;
      }
    }
  )
);
