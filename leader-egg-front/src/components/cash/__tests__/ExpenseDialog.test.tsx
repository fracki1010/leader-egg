import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-with-providers.tsx';
import { ExpenseDialog } from '../ExpenseDialog.tsx';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { expensesApiMock, vehiclesApiMock } = vi.hoisted(() => ({
  expensesApiMock: { list: vi.fn(), create: vi.fn(), getTotals: vi.fn(), remove: vi.fn() },
  vehiclesApiMock: { list: vi.fn() },
}));

vi.mock('../../../api/expenses.ts', () => ({ expensesApi: expensesApiMock }));
vi.mock('../../../api/vehicles.ts', () => ({ vehiclesApi: vehiclesApiMock }));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ExpenseDialog — Cuenta (money account)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expensesApiMock.list.mockResolvedValue({ expenses: [], total: 0, page: 1, limit: 50 });
    expensesApiMock.getTotals.mockResolvedValue({ total: 0, count: 0, breakdown: {} });
    vehiclesApiMock.list.mockResolvedValue([]);
    expensesApiMock.create.mockResolvedValue({});
  });

  it('creates an expense with account = Mercado Pago when selected', async () => {
    renderWithProviders(<ExpenseDialog open onClose={() => undefined} />);

    // Fill required fields (MUI appends " *" to required labels → regex match)
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '15000' } });
    fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: 'Combustible ruta' } });

    // Pick the money account: Mercado Pago
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cuenta/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Mercado Pago' }));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Crear Gasto/ }));

    await waitFor(() => {
      expect(expensesApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 15000, account: 'mp', description: 'Combustible ruta' })
      );
    });
  });

  it('defaults the expense account to Efectivo', async () => {
    renderWithProviders(<ExpenseDialog open onClose={() => undefined} />);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: 'Insumos' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear Gasto/ }));

    await waitFor(() => {
      expect(expensesApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5000, account: 'cash' })
      );
    });
  });

  it('calls onCreated after a successful create', async () => {
    const onCreated = vi.fn();
    renderWithProviders(<ExpenseDialog open onClose={() => undefined} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '1200' } });
    fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: 'Varios' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear Gasto/ }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(false));
  });
});
