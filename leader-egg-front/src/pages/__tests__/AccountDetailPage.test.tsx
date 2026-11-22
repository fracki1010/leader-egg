import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { AccountDetailPage } from '../AccountDetailPage.tsx';
import { useAuthStore } from '../../stores/authStore.ts';
import type { BusinessConfig, CashMovementsResponse, CashSummary } from '../../types/index.ts';
import { toLocalDate } from '../../lib/date.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { cashApiMock, setupApiMock } = vi.hoisted(() => ({
  cashApiMock: { listMovements: vi.fn(), getSummary: vi.fn() },
  setupApiMock: { getPuntoCero: vi.fn(), setPuntoCero: vi.fn(), updateOpeningBalances: vi.fn() },
}));

vi.mock('../../api/cash.ts', () => ({ cashApi: cashApiMock }));
vi.mock('../../api/setup.ts', () => ({ setupApi: setupApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Local timestamps — grouping reads local calendar days, never UTC. */
const todayAt = (hours: number, minutes: number): Date => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const yesterdayAt = (hours: number, minutes: number): Date => {
  const date = todayAt(hours, minutes);
  date.setDate(date.getDate() - 1);
  return date;
};

const summary: CashSummary = {
  accounts: { cash: 100000, mp: 25000, bank: 500000, total: 625000 },
  today: { in: 0, out: 0, net: 0 },
};

const puntoCero: BusinessConfig = {
  finalized: true,
  openingCash: 50000,
  openingBalances: { cash: 50000, mp: 10000, bank: 400000 },
  openingBalancesSetAt: {
    cash: new Date(2026, 9, 1, 12, 0, 0).toISOString(),
    mp: null,
    bank: null,
  },
  clientDebts: [],
  supplierDebts: [],
  stock: [],
};

const movements: CashMovementsResponse = {
  movements: [
    {
      id: 'mv-1',
      date: todayAt(10, 30).toISOString(),
      type: 'payment',
      account: 'cash',
      amount: 1000,
      description: 'Cobro pedido #12',
    },
    {
      id: 'mv-2',
      date: yesterdayAt(9, 15).toISOString(),
      type: 'expense',
      account: 'cash',
      amount: -300,
      description: 'Combustible ruta',
    },
  ],
  total: 2,
  page: 1,
  limit: 25,
  totals: { in: 1000, out: 300, net: 700 },
};

function renderPage(initialEntry = '/cuentas/cash') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/cuentas/:account" element={<AccountDetailPage />} />
        <Route path="/cuentas" element={<div>Lista de cuentas</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AccountDetailPage — per-account ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Opening balances require config.manage; grant it to the test admin.
    useAuthStore.setState({
      user: {
        _id: 'u1',
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        permissions: ['accounts.view', 'config.manage'],
      },
      token: 'tok',
      isAuthenticated: true,
      tenant: null,
    });
    cashApiMock.getSummary.mockResolvedValue(summary);
    cashApiMock.listMovements.mockResolvedValue(movements);
    setupApiMock.getPuntoCero.mockResolvedValue(puntoCero);
  });

  it('shows the balance, opening caption and movements grouped by local day', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Efectivo' })).toBeDefined();
    expect(screen.getByText('Caja principal y cobranzas')).toBeDefined();

    // Current balance (summary) + opening balance (punto cero).
    expect(screen.getByText('$ 100.000,00')).toBeDefined();
    expect(screen.getByText('$ 50.000,00')).toBeDefined();
    expect(screen.getByText(/Cargado el 01\/10\/2026 · Conciliado/)).toBeDefined();

    // Period totals from the response.
    expect(screen.getByText('$ 1.000,00')).toBeDefined();
    expect(screen.getByText('$ 300,00')).toBeDefined();
    expect(screen.getByText('+ $ 700,00')).toBeDefined();

    // Day headers and rows (signed amounts + descriptions).
    expect(screen.getByRole('region', { name: 'Hoy' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Ayer' })).toBeDefined();
    expect(screen.getByText('Cobro pedido #12')).toBeDefined();
    expect(screen.getByText('Combustible ruta')).toBeDefined();
    // Signed amounts appear on the row and on the day's net header.
    expect(screen.getAllByText('+ $ 1.000,00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('− $ 300,00').length).toBeGreaterThan(0);
  });

  it('requests the account with the selected preset and resets pagination', async () => {
    cashApiMock.listMovements.mockResolvedValue({ ...movements, total: 30 });
    renderPage();

    await screen.findByText('Mostrando 1–25 de 30');

    // Page 2 first, so the preset change proves the reset back to page 1.
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await screen.findByText('Mostrando 26–30 de 30');

    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));

    const today = toLocalDate(new Date());
    await waitFor(() => {
      const lastCall = cashApiMock.listMovements.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        account: 'cash',
        from: today,
        to: today,
        page: 1,
        limit: 25,
      });
    });
    await screen.findByText('Mostrando 1–25 de 30');
  });

  it('redirects an unknown account back to /cuentas', async () => {
    renderPage('/cuentas/efectivo');

    expect(await screen.findByText('Lista de cuentas')).toBeDefined();
    expect(cashApiMock.listMovements).not.toHaveBeenCalled();
  });
});
