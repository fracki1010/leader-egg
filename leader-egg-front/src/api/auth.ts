import { api } from './client.ts';
import type {
  AuthUser,
  ChangePasswordRequest,
  ChangePasswordResponse,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
} from '../types/index.ts';

export const authApi = {
  login(data: LoginRequest): Promise<LoginResponse> {
    return api.post<LoginResponse>('/v1/auth/login', data);
  },

  logout(): Promise<void> {
    return api.post<void>('/v1/auth/logout');
  },

  register(data: RegisterRequest): Promise<{ user: AuthUser }> {
    return api.post<{ user: AuthUser }>('/v1/auth/register', data);
  },

  /** GET /v1/auth/me — refresh the cached session's role and permissions. */
  me(): Promise<{ user: AuthUser }> {
    return api.get<{ user: AuthUser }>('/v1/auth/me');
  },

  /**
   * POST /v1/auth/change-password — self-service password change for any tenant
   * role. Every previously issued token is invalidated (tokenVersion), so the
   * response carries the replacement token the caller must persist.
   */
  changePassword(data: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    return api.post<ChangePasswordResponse>('/v1/auth/change-password', data);
  }
};
