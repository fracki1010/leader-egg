import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { SettingsPage } from '../SettingsPage.tsx';
import { useAuthStore } from '../../stores/authStore.ts';
import type { AuthUser, BusinessConfig, BusinessProfile, Tenant } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { setupApiMock } = vi.hoisted(() => ({
  setupApiMock: {
    getPuntoCero: vi.fn(),
    setPuntoCero: vi.fn(),
    updateOpeningBalances: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

vi.mock('../../api/setup.ts', () => ({ setupApi: setupApiMock }));

const { checkForNewVersionMock } = vi.hoisted(() => ({
  checkForNewVersionMock: vi.fn(),
}));

vi.mock('../../lib/app-version.ts', () => ({
  RUNNING_BUILD_ID: 'test-build',
  checkForNewVersion: checkForNewVersionMock,
  useNewVersion: vi.fn(),
}));

// The install banner probes `beforeinstallprompt` / matchMedia, which jsdom
// does not implement. Settings only renders it for drivers.
vi.mock('../../components/driver/InstallBanner.tsx', () => ({
  InstallBanner: () => null,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const tenant: Tenant = { id: 't1', name: 'Distribuidora del Sur', slug: 'distribuidora-del-sur' };

const profile: BusinessProfile = {
  businessName: 'El Huevo Líder',
  address: 'Av. Siempre Viva 742',
  phone: '11 5555-5555',
};

const puntoCero: BusinessConfig = {
  finalized: true,
  openingCash: 50000,
  openingBalances: { cash: 50000, mp: 10000, bank: 400000 },
  openingBalancesSetAt: { cash: null, mp: null, bank: null },
  clientDebts: [],
  supplierDebts: [],
  stock: [],
};

const adminWithConfig: AuthUser = {
  _id: 'u1',
  name: 'Nazareno',
  email: 'naza@example.com',
  role: 'admin',
  permissions: ['accounts.view', 'config.manage'],
};

const adminWithoutConfig: AuthUser = {
  ...adminWithConfig,
  permissions: ['accounts.view', 'users.manage'],
};

const driver: AuthUser = {
  _id: 'u2',
  name: 'Chofer',
  email: 'chofer@example.com',
  role: 'driver',
};

const superadmin: AuthUser = {
  ...adminWithConfig,
  _id: 'u3',
  role: 'superadmin',
};

const setUser = (user: AuthUser) =>
  useAuthStore.setState({ user, token: 'tok', isAuthenticated: true, tenant });

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SettingsPage — consolidated settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false, tenant: null });
    setupApiMock.getProfile.mockResolvedValue(profile);
    setupApiMock.getPuntoCero.mockResolvedValue(puntoCero);
    checkForNewVersionMock.mockResolvedValue(false);
  });

  it('shows only the personal sections to a driver', async () => {
    setUser(driver);
    renderPage();

    expect(await screen.findByText('Ajustes')).toBeDefined();
    expect(screen.getByText('Mi cuenta')).toBeDefined();
    expect(screen.getByText('Seguridad')).toBeDefined();
    expect(screen.getByText('Apariencia')).toBeDefined();
    expect(screen.getByText('Aplicación')).toBeDefined();
    expect(screen.getByText('Cerrar sesión')).toBeDefined();

    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.queryByText('Perfil del negocio')).toBeNull();
    expect(screen.queryByText('Equipo')).toBeNull();
    expect(screen.queryByText('Punto Cero')).toBeNull();
  });

  it('renders Empresa for an admin with config.manage', async () => {
    setUser(adminWithConfig);
    renderPage();

    expect(await screen.findByText('Empresa')).toBeDefined();
    expect(await screen.findByDisplayValue('El Huevo Líder')).toBeDefined();
    expect(screen.getByText('Perfil del negocio')).toBeDefined();
    expect(screen.getByText('Saldos iniciales')).toBeDefined();
    expect(screen.getByText('Punto Cero')).toBeDefined();

    // Punto Cero's wizard link is reserved for superadmin.
    expect(screen.queryByRole('button', { name: /Abrir Punto Cero/i })).toBeNull();
    // No users.manage → no team section.
    expect(screen.queryByText('Equipo')).toBeNull();
  });

  it('shows the Punto Cero link to superadmin', async () => {
    setUser(superadmin);
    renderPage();

    expect(await screen.findByRole('button', { name: /Abrir Punto Cero/i })).toBeDefined();
  });

  it('hides Empresa and never calls the setup endpoints without config.manage', async () => {
    setUser(adminWithoutConfig);
    renderPage();

    expect(await screen.findByText('Equipo')).toBeDefined();
    expect(screen.getByText('Gestionar usuarios')).toBeDefined();

    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.queryByText('Perfil del negocio')).toBeNull();

    await waitFor(() => expect(setupApiMock.getPuntoCero).not.toHaveBeenCalled());
    expect(setupApiMock.getProfile).not.toHaveBeenCalled();
  });
});
