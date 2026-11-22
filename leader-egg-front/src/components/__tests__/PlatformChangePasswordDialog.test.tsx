import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PlatformChangePasswordDialog } from '../PlatformChangePasswordDialog.tsx';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { platformApiMock } = vi.hoisted(() => ({
  platformApiMock: {
    login: vi.fn(),
    me: vi.fn(),
    changePassword: vi.fn(),
    listTenants: vi.fn(),
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
  },
}));

vi.mock('../../api/platform.ts', () => ({ platformApi: platformApiMock }));

// ─── Helpers ────────────────────────────────────────────────────────────────

const fillForm = (current: string, next: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText(/Contraseña actual/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/Repetir nueva contraseña/), {
    target: { value: confirm },
  });
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PlatformChangePasswordDialog', () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    renderWithProviders(
      <PlatformChangePasswordDialog
        open
        onClose={onClose}
        onSuccess={onSuccess}
        onError={onError}
      />,
    );
  });

  it('submits the current + new password through the API', async () => {
    platformApiMock.changePassword.mockResolvedValue(undefined);

    fillForm('old-secret', 'new-secret-1', 'new-secret-1');
    submit();

    await waitFor(() => {
      expect(platformApiMock.changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-secret',
        newPassword: 'new-secret-1',
      });
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it('blocks submit when the new password is shorter than 8 characters', () => {
    fillForm('old-secret', 'short', 'short');
    submit();

    expect(platformApiMock.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/al menos 8 caracteres/i)).toBeDefined();
  });

  it('blocks submit when the confirmation does not match', () => {
    fillForm('old-secret', 'new-secret-1', 'different-1');
    submit();

    expect(platformApiMock.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/no coinciden/i)).toBeDefined();
  });

  it('surfaces a server error and does not report success', async () => {
    platformApiMock.changePassword.mockRejectedValue(new Error('La contraseña actual es incorrecta'));

    fillForm('wrong-secret', 'new-secret-1', 'new-secret-1');
    submit();

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(await screen.findByText(/La contraseña actual es incorrecta/)).toBeDefined();
  });
});
