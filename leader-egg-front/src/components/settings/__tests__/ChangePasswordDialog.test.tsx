import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { ChangePasswordDialog } from '../ChangePasswordDialog.tsx';
import { useAuthStore } from '../../../stores/authStore.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { authApiMock } = vi.hoisted(() => ({
  authApiMock: { changePassword: vi.fn() },
}));

vi.mock('../../../api/auth.ts', () => ({ authApi: authApiMock }));

// ─── Helpers ────────────────────────────────────────────────────────────────

const fillForm = (current: string, next: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText(/^Contraseña actual/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/Repetir nueva contraseña/), {
    target: { value: confirm },
  });
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ChangePasswordDialog', () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ token: 'old-token', user: null, tenant: null, isAuthenticated: true });
    renderWithProviders(
      <ChangePasswordDialog open onClose={onClose} onSuccess={onSuccess} />,
    );
  });

  it('blocks submit when the new password is shorter than 8 characters', () => {
    fillForm('old-secret', 'short', 'short');
    submit();

    expect(authApiMock.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/al menos 8 caracteres/i)).toBeDefined();
  });

  it('blocks submit when the confirmation does not match', () => {
    fillForm('old-secret', 'new-secret-1', 'different-1');
    submit();

    expect(authApiMock.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/no coinciden/i)).toBeDefined();
  });

  it('rejects reusing the current password as the new one', () => {
    fillForm('same-secret-1', 'same-secret-1', 'same-secret-1');
    submit();

    expect(authApiMock.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/distinta de la actual/i)).toBeDefined();
  });

  it('calls the API and replaces the stored token on success', async () => {
    authApiMock.changePassword.mockResolvedValue({ token: 'new-token' });

    fillForm('old-secret', 'new-secret-1', 'new-secret-1');
    submit();

    await waitFor(() => {
      expect(authApiMock.changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-secret',
        newPassword: 'new-secret-1',
      });
    });
    await waitFor(() => expect(useAuthStore.getState().token).toBe('new-token'));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('surfaces a server error and does not report success', async () => {
    authApiMock.changePassword.mockRejectedValue(new Error('La contraseña actual es incorrecta'));

    fillForm('wrong-secret', 'new-secret-1', 'new-secret-1');
    submit();

    expect(await screen.findByText(/La contraseña actual es incorrecta/)).toBeDefined();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe('old-token');
  });
});
