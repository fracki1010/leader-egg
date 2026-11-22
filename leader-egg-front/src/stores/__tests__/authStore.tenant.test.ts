import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../authStore.ts';
import type { AuthUser, Tenant } from '../../types/index.ts';

// Mock the auth API so login/logout never hit the network.
const { authApiMock } = vi.hoisted(() => ({
  authApiMock: { login: vi.fn(), logout: vi.fn(), register: vi.fn() },
}));

vi.mock('../../api/auth.ts', () => ({ authApi: authApiMock }));

const user: AuthUser = {
  _id: 'u1',
  name: 'Nazareno',
  email: 'naza@elhuevolider.com',
  role: 'admin',
};

const tenant: Tenant = {
  id: 't1',
  name: 'Distribuidora del Sur',
  slug: 'distribuidora-del-sur',
};

function resetStore() {
  useAuthStore.setState({
    token: null,
    user: null,
    tenant: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });
}

describe('authStore — tenant awareness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetStore();
  });

  it('persists the tenant alongside the session on login', async () => {
    authApiMock.login.mockResolvedValue({ token: 'tok', user, tenant });

    await useAuthStore.getState().login({ email: user.email, password: 'secret' });

    expect(useAuthStore.getState().tenant).toEqual(tenant);

    const raw = localStorage.getItem('auth-storage');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as { state: { tenant: Tenant } };
    expect(parsed.state.tenant).toEqual(tenant);
  });

  it('clears the tenant on logout', async () => {
    authApiMock.logout.mockResolvedValue(undefined);
    useAuthStore.setState({ token: 'tok', user, tenant, isAuthenticated: true });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().tenant).toBeNull();

    const raw = localStorage.getItem('auth-storage');
    const parsed = JSON.parse(raw as string) as { state: { tenant: Tenant | null } };
    expect(parsed.state.tenant).toBeNull();
  });

  it('does not crash when the login response omits tenant (legacy backend)', async () => {
    authApiMock.login.mockResolvedValue({ token: 'tok', user });

    await useAuthStore.getState().login({ email: user.email, password: 'secret' });

    expect(useAuthStore.getState().tenant).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('rehydrates a legacy cached session without a tenant', async () => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({ state: { token: 'old-token', user, isAuthenticated: true }, version: 0 }),
    );

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().token).toBe('old-token');
    // Missing tenant in the cached state must not crash and must read as absent.
    expect(useAuthStore.getState().tenant).toBeFalsy();
  });
});
