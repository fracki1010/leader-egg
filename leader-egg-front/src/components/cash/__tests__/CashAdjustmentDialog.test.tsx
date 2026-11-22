import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { CashAdjustmentDialog } from '../CashAdjustmentDialog.tsx';
import type { DashboardSummary } from '../../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { cashAdjustmentsApiMock, dashboardApiMock } = vi.hoisted(() => ({
  cashAdjustmentsApiMock: { list: vi.fn(), create: vi.fn() },
  dashboardApiMock: { getSummary: vi.fn(), getAlerts: vi.fn() },
}));

vi.mock('../../../api/cash-adjustments.ts', () => ({ cashAdjustmentsApi: cashAdjustmentsApiMock }));
vi.mock('../../../api/dashboard.ts', () => ({ dashboardApi: dashboardApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const summary: DashboardSummary = {
  caja: 1000,
  cajaHoy: 0,
  saldos: { efectivo: 1000, mercadopago: 0, banco: 0, total: 1000 },
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
};

describe('CashAdjustmentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cashAdjustmentsApiMock.list.mockResolvedValue({
      adjustments: [],
      total: 0,
      page: 1,
      limit: 50,
      summary: { cash: 0, mp: 0, bank: 0, total: 0 },
    });
    cashAdjustmentsApiMock.create.mockResolvedValue({});
    dashboardApiMock.getSummary.mockResolvedValue(summary);
    dashboardApiMock.getAlerts.mockResolvedValue([]);
  });

  it('sends a NEGATIVE amount when tipo = Quitar dinero', async () => {
    renderWithProviders(<CashAdjustmentDialog open onClose={() => undefined} />);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '200' } });

    // Cuenta → Mercado Pago
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cuenta/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Mercado Pago' }));

    // Tipo → Quitar dinero
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Tipo/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Quitar dinero' }));

    // Motivo → Faltante
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Motivo/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Faltante' }));

    fireEvent.click(screen.getByRole('button', { name: /Registrar Ajuste/ }));

    await waitFor(() => {
      expect(cashAdjustmentsApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'mp', amount: -200, reason: 'missing' })
      );
    });
  });

  it('sends a POSITIVE amount when tipo = Agregar dinero', async () => {
    renderWithProviders(<CashAdjustmentDialog open onClose={() => undefined} />);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /Registrar Ajuste/ }));

    await waitFor(() => {
      expect(cashAdjustmentsApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'cash', amount: 500 })
      );
    });
  });

  it('rejects a zero amount without calling the API', async () => {
    renderWithProviders(<CashAdjustmentDialog open onClose={() => undefined} />);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Registrar Ajuste/ }));

    await screen.findByText('El monto debe ser un número positivo');
    expect(cashAdjustmentsApiMock.create).not.toHaveBeenCalled();
  });

  it('calls onCreated after a successful adjustment', async () => {
    const onCreated = vi.fn();
    renderWithProviders(<CashAdjustmentDialog open onClose={() => undefined} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '750' } });
    fireEvent.click(screen.getByRole('button', { name: /Registrar Ajuste/ }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(false));
  });
});
