import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PlatformUsersPage } from '../PlatformUsersPage.tsx';
import type { PlatformTenant, PlatformUser } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { platformApiMock } = vi.hoisted(() => ({
  platformApiMock: {
    listTenants: vi.fn(),
    listUsers: vi.fn(),
    searchUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetUserPassword: vi.fn(),
  },
}));

vi.mock('../../api/platform.ts', () => ({ platformApi: platformApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const acme: PlatformTenant = {
  id: 't1',
  name: 'Distribuidora Sur',
  slug: 'distribuidora-sur',
  dbName: 'tenant_sur',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  userCount: 1,
};

const globex: PlatformTenant = {
  id: 't2',
  name: 'Granja Norte',
  slug: 'granja-norte',
  dbName: 'tenant_norte',
  active: true,
  createdAt: '2026-02-01T00:00:00Z',
  userCount: 1,
};

const acmeUser: PlatformUser = {
  id: 'u1',
  name: 'Ana Pérez',
  email: 'ana@sur.com',
  role: 'admin',
  tenantId: 't1',
  tenantName: 'Distribuidora Sur',
  tenantSlug: 'distribuidora-sur',
  createdAt: '2026-01-15T00:00:00Z',
};

const globexUser: PlatformUser = {
  id: 'u2',
  name: 'Beto Gómez',
  email: 'beto@norte.com',
  role: 'driver',
  tenantId: 't2',
  tenantName: 'Granja Norte',
  tenantSlug: 'granja-norte',
  createdAt: '2026-02-02T00:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PlatformUsersPage — platform-wide user manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformApiMock.listTenants.mockResolvedValue([acme, globex]);
    platformApiMock.listUsers.mockImplementation((tenantId?: string) =>
      Promise.resolve(
        tenantId ? [acmeUser, globexUser].filter((u) => u.tenantId === tenantId) : [acmeUser, globexUser],
      ),
    );
    platformApiMock.searchUsers.mockResolvedValue([acmeUser, globexUser]);
  });

  it('renders users from every company with their role and company', async () => {
    renderWithProviders(<PlatformUsersPage />);

    expect(await screen.findByText('Ana Pérez')).toBeDefined();
    expect(screen.getByText('ana@sur.com')).toBeDefined();
    expect(screen.getByText('Distribuidora Sur')).toBeDefined();

    expect(screen.getByText('Beto Gómez')).toBeDefined();
    expect(screen.getByText('beto@norte.com')).toBeDefined();
    expect(screen.getByText('Granja Norte')).toBeDefined();

    // Role chips.
    expect(screen.getByText('Administrador')).toBeDefined();
    expect(screen.getByText('Repartidor')).toBeDefined();
  });

  it('filters users by company through the company selector', async () => {
    renderWithProviders(<PlatformUsersPage />);
    await screen.findByText('Ana Pérez');

    fireEvent.mouseDown(screen.getByLabelText('Empresa'));
    const option = await screen.findByRole('option', { name: 'Distribuidora Sur' });
    fireEvent.click(option);

    await waitFor(() => {
      expect(platformApiMock.listUsers).toHaveBeenCalledWith('t1');
    });

    expect(await screen.findByText('Ana Pérez')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText('Beto Gómez')).toBeNull();
    });
  });

  it('deletes a user after confirming in the dialog', async () => {
    platformApiMock.deleteUser.mockResolvedValue(undefined);

    renderWithProviders(<PlatformUsersPage />);
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Ana Pérez' }));

    // Confirm dialog is open.
    expect(await screen.findByText('Eliminar usuario')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => {
      expect(platformApiMock.deleteUser).toHaveBeenCalledWith('u1', 't1');
    });
  });
});
