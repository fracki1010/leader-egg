import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { platformApi } from '../api/platform.ts';
import type { PlatformAdmin, PlatformLoginRequest } from '../types/index.ts';

/**
 * Platform (multi-tenant super-admin) auth store.
 *
 * Deliberately independent from `authStore`: a platform admin is NOT a tenant
 * user. It persists under its own localStorage key (`platform-auth`) so the two
 * sessions can coexist without overwriting each other.
 */
interface PlatformAuthState {
  token: string | null;
  admin: PlatformAdmin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (credentials: PlatformLoginRequest) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

export const usePlatformAuthStore = create<PlatformAuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (credentials: PlatformLoginRequest) => {
        set({ isLoading: true, error: null });
        try {
          const response = await platformApi.login(credentials);
          set({
            token: response.token,
            admin: response.admin,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      logout: () =>
        set({
          token: null,
          admin: null,
          isAuthenticated: false,
          error: null,
        }),

      clearError: () => set({ error: null }),
    }),
    {
      name: 'platform-auth',
      partialize: (state) => ({
        token: state.token,
        admin: state.admin,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
