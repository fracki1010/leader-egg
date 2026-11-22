import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { DashboardPage } from '../DashboardPage.tsx';
import type { DashboardSummary } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { dashboardApiMock, ordersApiMock, setupApiMock, navigateMock } = vi.hoisted(() => ({
  dashboardApiMock: { getSummary: vi.fn(), getAlerts: vi.fn() },
  ordersApiMock: { list: vi.fn() },
  setupApiMock: { getPuntoCero: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/dashboard.ts', () => ({ dashboardApi: dashboardApiMock }));
vi.mock('../../api/orders.ts', () => ({ ordersApi: ordersApiMock }));
vi.mock('../../api/setup.ts', () => ({ setupApi: setupApiMock }));
vi.mock('../../stores/authStore.ts', () => ({
  useAuthStore: (selector?: (state: { user: { role: string; name: string } }) => unknown) =>
    selector ? selector({ user: { role: 'admin', name: 'Admin' } }) : { user: { role: 'admin', name: 'Admin' } },
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const formatMoney = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

const summary: DashboardSummary = {
  caja: 3250,
  cajaHoy: 120,
  saldos: { efectivo: 1100, mercadopago: 450, banco: 1700, total: 3250 },
  ventasHoy: 2500,
  cobradoHoy: 1800,
  ventasPorCanal: [{ canal: 'reparto', monto: 2500, ordenes: 3 }],
  porCobrar: 800,
  clientesDeudores: 2,
  puntoCeroFinalized: true,
  vencidas: { count: 0, total: 0 },
  stock: [],
  totalStockValue: 0,
  entregasHoy: 2,
  pendientesHoy: 1,
  deudas: [],
  cierreHoy: { closed: true, date: '2026-10-04' },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardPage — saldos por cuenta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardApiMock.getSummary.mockResolvedValue(summary);
    dashboardApiMock.getAlerts.mockResolvedValue([]);
    ordersApiMock.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5 });
    setupApiMock.getPuntoCero.mockResolvedValue({
      finalized: true,
      openingCash: 0,
      openingBalances: { cash: 0, mp: 0, bank: 0 },
      openingBalancesSetAt: { cash: null, mp: null, bank: null },
      clientDebts: [],
      supplierDebts: [],
      stock: [],
    });
  });

  it('renders the three balance mini-cards with per-account saldos', async () => {
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Ventas de hoy')).toBeDefined();
    });

    // Balance strip labels
    expect(screen.getByText('Efectivo')).toBeDefined();
    expect(screen.getByText('Mercado Pago')).toBeDefined();
    expect(screen.getByText('Banco')).toBeDefined();

    // Per-account values come from summary.saldos
    expect(screen.getByText(formatMoney(1100))).toBeDefined();
    expect(screen.getByText(formatMoney(450))).toBeDefined();
    expect(screen.getByText(formatMoney(1700))).toBeDefined();
  });

  it('shows honest sales-vs-collected semantics on the day card', async () => {
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Ventas de hoy')).toBeDefined();
    });

    // Value = billed today; subline = actually collected today (gross).
    // 2500 also appears in the per-channel breakdown → assert presence, not uniqueness.
    expect(screen.getAllByText(formatMoney(2500)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(`Cobrado hoy: ${formatMoney(1800)}`)).toBeDefined();

    // Chip = collection rate 1800 / 2500 = 72%.
    expect(screen.getByText('72%')).toBeDefined();
  });

  it('keeps the Caja Total card as the grand total', async () => {
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Caja Total')).toBeDefined();
    });
    expect(screen.getByText(formatMoney(3250))).toBeDefined();
  });

  it('falls back to caja when saldos is missing (legacy backend)', async () => {
    const { saldos: _saldos, ...legacy } = summary;
    dashboardApiMock.getSummary.mockResolvedValue(legacy as DashboardSummary);

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Efectivo')).toBeDefined();
    });
    // Whole caja collapses into Efectivo — the total shows on both the Caja
    // Total card and the Efectivo balance card.
    expect(screen.getAllByText(formatMoney(3250)).length).toBeGreaterThanOrEqual(2);
  });
});