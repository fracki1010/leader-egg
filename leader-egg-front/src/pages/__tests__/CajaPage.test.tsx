import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { CajaPage } from '../CajaPage.tsx';
import type { CashMovementsResponse, CashSummary } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const {
  cashApiMock,
  vehiclesApiMock,
  dashboardApiMock,
  expensesApiMock,
  cashAdjustmentsApiMock,
} = vi.hoisted(() => ({
  cashApiMock: { listMovements: vi.fn(), getSummary: vi.fn() },
  vehiclesApiMock: { list: vi.fn() },
  dashboardApiMock: { getSummary: vi.fn(), getAlerts: vi.fn() },
  expensesApiMock: { list: vi.fn(), create: vi.fn(), getTotals: vi.fn(), remove: vi.fn() },
  cashAdjustmentsApiMock: { list: vi.fn(), create: vi.fn() },
}));

vi.mock('../../api/cash.ts', () => ({ cashApi: cashApiMock }));
vi.mock('../../api/vehicles.ts', () => ({ vehiclesApi: vehiclesApiMock }));
vi.mock('../../api/dashboard.ts', () => ({ dashboardApi: dashboardApiMock }));
vi.mock('../../api/expenses.ts', () => ({ expensesApi: expensesApiMock }));
vi.mock('../../api/cash-adjustments.ts', () => ({ cashAdjustmentsApi: cashAdjustmentsApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const summary: CashSummary = {
  accounts: { cash: 1000, mp: 500, bank: 2000, total: 3500 },
  today: { in: 1500, out: 300, net: 1200 },
};

const movements: CashMovementsResponse = {
  movements: [
    {
      id: 'mv-1',
      date: '2026-10-16T10:00:00.000Z',
      type: 'payment',
      account: 'cash',
      amount: 1000,
      description: 'Cobro pedido #1',
    },
    {
      id: 'mv-2',
      date: '2026-10-16T11:00:00.000Z',
      type: 'expense',
      account: 'cash',
      amount: -500,
      description: 'Combustible ruta',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totals: { in: 1000, out: 500, net: 500 },
};

const formatMoney = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

/** Local `YYYY-MM-DD` helper mirroring the page's preset math. */
const toLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

describe('CajaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cashApiMock.getSummary.mockResolvedValue(summary);
    cashApiMock.listMovements.mockResolvedValue(movements);
    vehiclesApiMock.list.mockResolvedValue([]);
    dashboardApiMock.getSummary.mockResolvedValue({
      caja: 0,
      cajaHoy: 0,
      saldos: { efectivo: 0, mercadopago: 0, banco: 0, total: 0 },
      ventasHoy: 0,
      cobradoHoy: 0,
      ventasPorCanal: [],
      porCobrar: 0,
      clientesDeudores: 0,
      puntoCeroFinalized: true,
      vencidas: { count: 0, total: 0 },
      stock: [],
      totalStockValue: 0,
      entregasHoy: 0,
      pendientesHoy: 0,
      deudas: [],
      cierreHoy: { closed: false, date: '2026-10-16' },
    });
    dashboardApiMock.getAlerts.mockResolvedValue([]);
    expensesApiMock.create.mockResolvedValue({});
    cashAdjustmentsApiMock.create.mockResolvedValue({});
  });

  it('renders the accounts tabs with Movimientos active and no duplicated balances', async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/cuentas/movimientos']}>
        <CajaPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Cobros, gastos y ajustes de todas las cuentas')).toBeDefined();

    const resumenTab = screen.getByRole('tab', { name: /Resumen/ });
    const movimientosTab = screen.getByRole('tab', { name: /Movimientos/ });
    expect(movimientosTab.getAttribute('aria-selected')).toBe('true');
    expect(resumenTab.getAttribute('aria-selected')).toBe('false');

    // Per-account balances live in Resumen now — never duplicated here.
    expect(screen.queryByText('Saldos por cuenta')).toBeNull();
    expect(screen.queryByText(formatMoney(3500))).toBeNull();
  });

  it("renders today's in / out / net summary", async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    await screen.findByText('Entradas');
    expect(screen.getByText('Salidas')).toBeDefined();
    expect(screen.getByText('Neto')).toBeDefined();

    expect(await screen.findByText('+ $ 1.500,00')).toBeDefined();
    expect(screen.getByText('− $ 300,00')).toBeDefined();
    expect(screen.getByText('+ $ 1.200,00')).toBeDefined();
  });

  it('renders the movements list with correct +/− coloring', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const incoming = await screen.findByText('+ $ 1.000,00');
    const outgoing = screen.getByText('− $ 500,00');

    expect(incoming.getAttribute('data-tone')).toBe('in');
    expect(outgoing.getAttribute('data-tone')).toBe('out');

    // Type chips + descriptions (the filter chips also carry these labels).
    expect(screen.getAllByText('Pago').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Gasto').length).toBeGreaterThan(0);
    expect(screen.getByText('Cobro pedido #1')).toBeDefined();
    expect(screen.getByText('Combustible ruta')).toBeDefined();
  });

  it('applies an account filter from the account chips (calls the API with the filter)', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Cuenta: Efectivo' }));

    await waitFor(() => {
      expect(cashApiMock.listMovements).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'cash' })
      );
    });
  });

  it('applies a type filter from the type chips (calls the API with the filter)', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Tipo: Gasto' }));

    await waitFor(() => {
      expect(cashApiMock.listMovements).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'expense', page: 1 })
      );
    });
  });

  it('computes today\'s range when the "Hoy" preset is selected', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Hoy' }));

    const today = toLocalDate(new Date());
    await waitFor(() => {
      expect(cashApiMock.listMovements).toHaveBeenCalledWith(
        expect.objectContaining({ from: today, to: today, page: 1 })
      );
    });
  });

  it('only shows "Limpiar" when a filter is active and clears every filter on click', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Cuenta: Efectivo' });
    expect(screen.queryByRole('button', { name: 'Limpiar' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cuenta: Efectivo' }));

    const clearButton = await screen.findByRole('button', { name: 'Limpiar' });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Limpiar' })).toBeNull();
      expect(cashApiMock.listMovements).toHaveBeenLastCalledWith(
        expect.objectContaining({ account: undefined, type: undefined, from: undefined, to: undefined, page: 1 })
      );
    });
  });

  it('renders the page-size select in the movements header', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    const limitSelect = await screen.findByRole('combobox', { name: 'Por página' });
    expect(limitSelect).toBeDefined();
    expect(await screen.findByText('2 total')).toBeDefined();
  });

  it('opens the "Registrar gasto" dialog', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Registrar gasto/ }));

    expect(await screen.findByText('Nuevo Gasto')).toBeDefined();
  });

  it('opens the "Ajustar caja" dialog', async () => {
    renderWithProviders(
      <MemoryRouter>
        <CajaPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Ajustar caja/ }));

    expect(await screen.findByText('Nuevo Ajuste de Caja')).toBeDefined();
  });
});
