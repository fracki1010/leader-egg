import { api } from './client.ts';
import type { AppUser, Driver, UpdateUserRequest } from '../types/index.ts';

export const usersApi = {
  listDrivers(): Promise<Driver[]> {
    return api.get<Driver[]>('/v1/users/drivers');
  },

  /** List ALL users (admin only), sorted by name. */
  list(): Promise<AppUser[]> {
    return api.get<AppUser[]>('/v1/users');
  },

  /**
   * Update a user's role and/or permissions (admin only).
   * 409 when changing your own role or removing `users.manage` from the last admin.
   */
  update(id: string, data: UpdateUserRequest): Promise<{ user: AppUser }> {
    return api.patch<{ user: AppUser }>(`/v1/users/${id}`, data satisfies UpdateUserRequest);
  },

  /**
   * Set (or clear, with null) the WhatsApp number the assistant answers as this user.
   * 400 for a number without a country code, 409 when another user already holds it.
   */
  setWhatsappPhone(id: string, phone: string | null): Promise<{ phone: string | null }> {
    return api.put<{ phone: string | null }>(`/v1/users/${id}/whatsapp-phone`, { phone });
  },

  /** Delete a user (admin only). 409 if self-delete or routes assigned. */
  remove(id: string): Promise<void> {
    return api.delete<void>(`/v1/users/${id}`);
  }
};
