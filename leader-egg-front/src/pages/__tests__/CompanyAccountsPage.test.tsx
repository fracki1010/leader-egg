import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { CompanyAccountsPage } from '../CompanyAccountsPage.tsx';
import { useAuthStore } from '../../stores/authStore.ts';
import type { AuthUser, BusinessConfig, CashSummary } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { cashApiMock, setupApiMock } = vi.hoisted(() => ({
  cashApiMock: { getSummary: vi.fn() },
  setupApiMock: { getPuntoCero: vi.fn(), setPuntoCero: vi.fn(), updateOpeningBalances: vi.fn() },
}));

vi.mock('../../api/cash.ts', () => ({ cashApi: cashApiMock }));
vi.mock('../../api/setup.ts', () => ({ setupApi: setupApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const summary: CashSummary = {
  accounts: { cash: 100000, mp: 25000, bank: 500000, total: 625000 },
  today: { in: 0, out: 0, net: 0 },
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
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['accounts.view', 'config.manage'],
};

const adminWithoutConfig: AuthUser = {
  ...adminWithConfig,
  permissions: ['accounts.view'],
};

const setUser = (user: AuthUser) =>
  useAuthStore.setState({ user, token: 'tok', isAuthenticated: true, tenant: null });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CompanyAccountsPage — Cuentas de la Empresa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false, tenant: null });
    cashApiMock.getSummary.mockResolvedValue(summary);
    setupApiMock.getPuntoCero.mockResolvedValue(puntoCero);
    setupApiMock.updateOpeningBalances.mockResolvedValue(puntoCero);
  });

  it('renders the three accounts and the read-only opening balances for config.manage', async () => {
    setUser(adminWithConfig);
    renderWithProviders(
      <MemoryRouter>
        <CompanyAccountsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Cuentas de la Empresa')).toBeDefined();
    expect(screen.getByText('Efectivo, Mercado Pago y saldos bancarios')).toBeDefined();

    // The three accounts appear once in the card and once in the compact
    // breakdown of the consolidated card.
    expect(screen.getAllByText('Efectivo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mercado Pago').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Banco').length).toBeGreaterThan(0);

    // Current balances (from /cash/summary.accounts).
    expect(screen.getByText('$ 100.000,00')).toBeDefined();
    expect(screen.getByText('$ 25.000,00')).toBeDefined();
    expect(screen.getByText('$ 500.000,00')).toBeDefined();
    // Opening balances (from the punto-cero state).
    expect(screen.getByText('$ 50.000,00')).toBeDefined();
    expect(screen.getByText('$ 10.000,00')).toBeDefined();
    expect(screen.getByText('$ 400.000,00')).toBeDefined();
    // Current total.
    expect(screen.getByText('$ 625.000,00')).toBeDefined();
    // Editing moved to Settings; the page only links there.
    expect(screen.queryByRole('button', { name: /Editar saldo inicial/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Configurar en Ajustes/i })).toBeDefined();
  });

  it('does not call the punto-cero endpoint (or render opening balances) without config.manage', async () => {
    setUser(adminWithoutConfig);
    renderWithProviders(
      <MemoryRouter>
        <CompanyAccountsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Cuentas de la Empresa')).toBeDefined();

    // Current balances still render.
    expect(screen.getByText('$ 100.000,00')).toBeDefined();

    // `accounts.view` cannot read setup: no request, no opening-balance block.
    expect(setupApiMock.getPuntoCero).not.toHaveBeenCalled();
    expect(screen.queryByText('Saldo inicial')).toBeNull();
    expect(screen.queryByRole('button', { name: /Configurar en Ajustes/i })).toBeNull();

    // Give the query a tick to prove it never fires.
    await waitFor(() => expect(setupApiMock.getPuntoCero).not.toHaveBeenCalled());
  });
});
