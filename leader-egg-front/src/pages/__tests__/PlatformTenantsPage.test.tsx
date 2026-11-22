import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PlatformTenantsPage } from '../PlatformTenantsPage.tsx';
import type { PlatformTenant } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { platformApiMock } = vi.hoisted(() => ({
  platformApiMock: {
    login: vi.fn(),
    listTenants: vi.fn(),
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
  },
}));

vi.mock('../../api/platform.ts', () => ({ platformApi: platformApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const activeTenant: PlatformTenant = {
  id: 't1',
  name: 'Distribuidora Sur',
  slug: 'distribuidora-sur',
  dbName: 'tenant_sur',
  active: true,
  createdAt: '2026-01-15T00:00:00Z',
  userCount: 12,
};

const suspendedTenant: PlatformTenant = {
  id: 't2',
  name: 'Granja Norte',
  slug: 'granja-norte',
  dbName: 'tenant_norte',
  active: false,
  createdAt: '2026-02-01T00:00:00Z',
  userCount: 3,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter>
      <PlatformTenantsPage />
    </MemoryRouter>,
  );

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PlatformTenantsPage — tenant manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformApiMock.listTenants.mockResolvedValue([activeTenant, suspendedTenant]);
  });

  it('renders every tenant with its slug and status', async () => {
    renderPage();

    expect(await screen.findByText('Distribuidora Sur')).toBeDefined();
    expect(screen.getByText('@distribuidora-sur')).toBeDefined();
    expect(screen.getByText('tenant_sur')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();

    expect(screen.getByText('Granja Norte')).toBeDefined();
    expect(screen.getByText('@granja-norte')).toBeDefined();

    // One active, one suspended.
    expect(screen.getByText('Activa')).toBeDefined();
    expect(screen.getByText('Suspendida')).toBeDefined();

    // Suspend action for the active tenant, Activate for the suspended one.
    expect(screen.getByRole('button', { name: 'Suspender' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Activar' })).toBeDefined();
  });

  it('creates a tenant: auto-slug + calls the API with the full payload', async () => {
    platformApiMock.createTenant.mockResolvedValue({
      ...activeTenant,
      name: 'Distribuidora del Sur',
      slug: 'distribuidora-del-sur',
    });

    renderPage();
    await screen.findByText('Distribuidora Sur');

    fireEvent.click(screen.getByRole('button', { name: 'Nueva empresa' }));

    const nameInput = await screen.findByLabelText(/Nombre de la empresa/);
    fireEvent.change(nameInput, { target: { value: 'Distribuidora del Sur' } });

    // Slug is derived from the name.
    const slugInput = screen.getByLabelText(/^Slug/) as HTMLInputElement;
    expect(slugInput.value).toBe('distribuidora-del-sur');

    fireEvent.change(screen.getByLabelText(/Nombre del administrador/), { target: { value: 'Ana Pérez' } });
    fireEvent.change(screen.getByLabelText(/Email del administrador/), { target: { value: 'ana@sur.com' } });
    fireEvent.change(screen.getByLabelText(/Contraseña del administrador/), { target: { value: 'secret1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    await waitFor(() => {
      expect(platformApiMock.createTenant).toHaveBeenCalledWith({
        name: 'Distribuidora del Sur',
        slug: 'distribuidora-del-sur',
        adminName: 'Ana Pérez',
        adminEmail: 'ana@sur.com',
        adminPassword: 'secret1',
      });
    });

    // Success refreshes the list.
    await waitFor(() => {
      expect(platformApiMock.listTenants.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('requires the exact slug before deleting a tenant', async () => {
    platformApiMock.deleteTenant.mockResolvedValue(undefined);

    renderPage();
    await screen.findByText('Distribuidora Sur');

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Distribuidora Sur' }));

    const confirm = screen.getByRole('button', { name: 'Eliminar empresa' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const slugInput = screen.getByLabelText(/Escribí el slug para confirmar/);
    fireEvent.change(slugInput, { target: { value: 'wrong-slug' } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(slugInput, { target: { value: 'distribuidora-sur' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));

    fireEvent.click(confirm);

    await waitFor(() => {
      expect(platformApiMock.deleteTenant).toHaveBeenCalledWith('t1', 'distribuidora-sur');
    });
  });
});
