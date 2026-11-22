import { ApiError, API_BASE_URL } from './client.ts';
import type {
  ChangePasswordRequest,
  CreatePlatformUserRequest,
  CreateTenantRequest,
  PlatformAdmin,
  PlatformLoginRequest,
  PlatformLoginResponse,
  PlatformPuntoCero,
  PlatformTenant,
  PlatformTenantResetResult,
  PlatformUser,
  SetPlatformPuntoCeroPayload,
  UpdatePlatformUserRequest,
  UpdateTenantRequest,
} from '../types/index.ts';

/**
 * Platform (multi-tenant super-admin) API client.
 *
 * This is a SMALL, SEPARATE client on purpose: the tenant client (`api`) always
 * attaches the tenant token from `auth-storage` and, on 401, clears tenant auth
 * and redirects to `/login`. Platform calls must use the PLATFORM token instead
 * and redirect to `/platform/login` on 401 — so they get their own request
 * pipeline. The tenant client is left completely untouched.
 */

/** localStorage key owned by the platform auth store. Kept in sync with
 *  `src/stores/platformAuthStore.ts` (zustand persist `name`). */
export const PLATFORM_STORAGE_KEY = 'platform-auth';

/** Read the platform token straight from its persisted store. Reading storage
 *  directly (instead of importing the store) avoids an import cycle. */
function getPlatformToken(): string | null {
  try {
    const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed.state?.token ?? null;
  } catch {
    return null;
  }
}

function clearPlatformAuth(): void {
  try {
    localStorage.removeItem(PLATFORM_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode) — nothing else to do.
  }
}

interface PlatformRequestOptions {
  method?: string;
  body?: unknown;
  /** Attach the platform bearer token. Defaults to true; set false for login. */
  auth?: boolean;
}

async function platformRequest<T>(
  endpoint: string,
  { method = 'GET', body, auth = true }: PlatformRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = auth ? getPlatformToken() : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      clearPlatformAuth();
      if (window.location.pathname !== '/platform/login') {
        window.location.href = '/platform/login';
      }
    }

    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : `Request failed with status ${response.status}`;

    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

export const platformApi = {
  /** POST /v1/platform/auth/login — platform super-admin credentials. */
  login(data: PlatformLoginRequest): Promise<PlatformLoginResponse> {
    return platformRequest<PlatformLoginResponse>('/v1/platform/auth/login', {
      method: 'POST',
      body: data,
      auth: false,
    });
  },

  /** GET /v1/platform/me — the signed-in platform admin. */
  async me(): Promise<PlatformAdmin> {
    const { admin } = await platformRequest<{ admin: PlatformAdmin }>('/v1/platform/me');
    return admin;
  },

  /** PATCH /v1/platform/me/password — change the signed-in admin's password. */
  changePassword(data: ChangePasswordRequest): Promise<void> {
    return platformRequest<void>('/v1/platform/me/password', {
      method: 'PATCH',
      body: data,
    });
  },

  /** GET /v1/platform/tenants — every registered company. */
  listTenants(): Promise<PlatformTenant[]> {
    return platformRequest<PlatformTenant[]>('/v1/platform/tenants');
  },

  /** POST /v1/platform/tenants — provision a company + its first admin. */
  async createTenant(data: CreateTenantRequest): Promise<PlatformTenant> {
    const { tenant } = await platformRequest<{ tenant: PlatformTenant }>(
      '/v1/platform/tenants',
      {
        method: 'POST',
        body: data,
      },
    );
    return tenant;
  },

  /** PATCH /v1/platform/tenants/:id — rename or toggle active. */
  async updateTenant(id: string, data: UpdateTenantRequest): Promise<PlatformTenant> {
    const { tenant } = await platformRequest<{ tenant: PlatformTenant }>(
      `/v1/platform/tenants/${id}`,
      {
        method: 'PATCH',
        body: data,
      },
    );
    return tenant;
  },

  /** DELETE /v1/platform/tenants/:id — requires `{ confirm: '<slug>' }`. */
  deleteTenant(id: string, slug: string): Promise<void> {
    return platformRequest<void>(`/v1/platform/tenants/${id}`, {
      method: 'DELETE',
      body: { confirm: slug },
    });
  },

  /**
   * POST /v1/platform/tenants/:id/reset — clear a tenant's business data.
   * Requires `confirm: '<slug>'`; `zeroCustomerDebt` opts into zeroing the
   * customers' opening debt (off by default).
   */
  resetTenant(
    tenantId: string,
    payload: { confirm: string; zeroCustomerDebt?: boolean },
  ): Promise<PlatformTenantResetResult> {
    return platformRequest<PlatformTenantResetResult>(
      `/v1/platform/tenants/${tenantId}/reset`,
      { method: 'POST', body: payload },
    );
  },

  /**
   * GET /v1/platform/tenants/:id/punto-cero — read a tenant's initial setup
   * state (opening balances, stock, customer/supplier opening debts).
   */
  getPuntoCero(tenantId: string): Promise<PlatformPuntoCero> {
    return platformRequest<PlatformPuntoCero>(
      `/v1/platform/tenants/${tenantId}/punto-cero`,
    );
  },

  /**
   * POST /v1/platform/tenants/:id/punto-cero — run the tenant's punto cero.
   * The backend answers 409 when the setup is already finalized unless
   * `force: true` is sent. Returns the refreshed GET payload.
   */
  setPuntoCero(
    tenantId: string,
    payload: SetPlatformPuntoCeroPayload,
  ): Promise<PlatformPuntoCero> {
    return platformRequest<PlatformPuntoCero>(
      `/v1/platform/tenants/${tenantId}/punto-cero`,
      { method: 'POST', body: payload },
    );
  },

  /** GET /v1/platform/users — every user across all tenants (optionally one). */
  listUsers(tenantId?: string): Promise<PlatformUser[]> {
    const query = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    return platformRequest<PlatformUser[]>(`/v1/platform/users${query}`);
  },

  /** GET /v1/platform/users?search= — case-insensitive name/email search. */
  searchUsers(q: string): Promise<PlatformUser[]> {
    return platformRequest<PlatformUser[]>(
      `/v1/platform/users?search=${encodeURIComponent(q)}`,
    );
  },

  /** POST /v1/platform/users — create a user inside a specific company. */
  async createUser(data: CreatePlatformUserRequest): Promise<PlatformUser> {
    const { user } = await platformRequest<{ user: PlatformUser }>('/v1/platform/users', {
      method: 'POST',
      body: data,
    });
    return user;
  },

  /** PATCH /v1/platform/users/:id — rename or change role (tenantId required). */
  async updateUser(id: string, data: UpdatePlatformUserRequest): Promise<PlatformUser> {
    const { user } = await platformRequest<{ user: PlatformUser }>(
      `/v1/platform/users/${id}`,
      { method: 'PATCH', body: data },
    );
    return user;
  },

  /** DELETE /v1/platform/users/:id?tenant= — remove a user from its company. */
  deleteUser(id: string, tenantId: string): Promise<void> {
    return platformRequest<void>(
      `/v1/platform/users/${id}?tenant=${encodeURIComponent(tenantId)}`,
      { method: 'DELETE' },
    );
  },

  /** POST /v1/platform/users/:id/reset-password — set a new password. */
  resetUserPassword(id: string, tenantId: string, newPassword: string): Promise<void> {
    return platformRequest<void>(`/v1/platform/users/${id}/reset-password`, {
      method: 'POST',
      body: { tenantId, newPassword },
    });
  },
};
