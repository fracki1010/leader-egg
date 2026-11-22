import { api } from './client.ts';
import type { BusinessConfig, BusinessProfile, SetupPuntoCeroPayload } from '../types/index.ts';

/**
 * PATCH /v1/setup/opening-balances — explicit correction of the INITIAL
 * per-account opening balances ("Cuentas de la Empresa"). Every account is
 * optional; at least one must be present. All values must be >= 0.
 */
export interface UpdateOpeningBalancesPayload {
  cash?: number;
  mp?: number;
  bank?: number;
}

/**
 * PATCH /v1/setup/profile — partial update of the business identity.
 * At least one field is required; `businessName` cannot be empty while
 * `address` / `phone` accept an empty string to clear them.
 */
export interface UpdateBusinessProfilePayload {
  businessName?: string;
  address?: string;
  phone?: string;
}

export const setupApi = {
  /** GET /v1/setup/punto-cero — current setup state (defaults before any POST). */
  getPuntoCero(): Promise<BusinessConfig> {
    return api.get<BusinessConfig>('/v1/setup/punto-cero');
  },

  /** POST /v1/setup/punto-cero — one-time finalize (409 once finalized). */
  setPuntoCero(payload: SetupPuntoCeroPayload): Promise<BusinessConfig> {
    return api.post<BusinessConfig>('/v1/setup/punto-cero', payload);
  },

  /**
   * PATCH /v1/setup/opening-balances — correct the recorded starting balances.
   * Allowed after finalize. Returns the refreshed punto-cero state (so the new
   * opening balances arrive in one round trip).
   */
  updateOpeningBalances(payload: UpdateOpeningBalancesPayload): Promise<BusinessConfig> {
    return api.patch<BusinessConfig>('/v1/setup/opening-balances', payload);
  },

  /** GET /v1/setup/profile — the tenant's business identity (admin + config.manage). */
  getProfile(): Promise<BusinessProfile> {
    return api.get<BusinessProfile>('/v1/setup/profile');
  },

  /** PATCH /v1/setup/profile — partial update; returns the refreshed profile. */
  updateProfile(payload: UpdateBusinessProfilePayload): Promise<BusinessProfile> {
    return api.patch<BusinessProfile>('/v1/setup/profile', payload);
  }
};
