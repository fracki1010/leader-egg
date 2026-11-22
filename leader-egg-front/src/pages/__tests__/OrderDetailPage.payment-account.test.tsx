import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { OrderDetailPage } from '../OrderDetailPage.tsx';
import type { Order } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { ordersApiMock, paymentsApiMock, returnsApiMock, navigateMock } = vi.hoisted(() => ({
  ordersApiMock: { get: vi.fn(), transitionStatus: vi.fn() },
  paymentsApiMock: { record: vi.fn(), list: vi.fn() },
  returnsApiMock: { listForOrder: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'order-1' }),
  useNavigate: () => navigateMock,
}));
vi.mock('../../api/orders.ts', () => ({ ordersApi: ordersApiMock }));
vi.mock('../../api/payments.ts', () => ({ paymentsApi: paymentsApiMock }));
vi.mock('../../api/returns.ts', () => ({ returnsApi: returnsApiMock }));
vi.mock('../../api/products.ts', () => ({ productsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../stores/authStore.ts', () => ({
  useAuthStore: (selector?: (state: { user: { role: string; name: string } }) => unknown) =>
    selector ? selector({ user: { role: 'admin', name: 'Admin' } }) : { user: { role: 'admin', name: 'Admin' } },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const order: Order = {
  _id: 'order-1',
  orderNumber: 'ORD-100',
  customerId: 'cust-1',
  customerName: 'Cliente Test',
  channel: 'phone',
  deliveryAddress: 'Av. Test 123',
  items: [],
  totalAmount: 100,
  status: 'in_transit',
  paymentPreference: 'partial',
  paymentStatus: 'partial',
  paidAmount: 50,
  balance: 50,
  returnedAmount: 0,
  dueDate: null,
  routeId: null,
  routeStopId: null,
  auditLog: [],
  createdAt: '2026-10-04T12:00:00Z',
  updatedAt: '2026-10-04T12:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OrderDetailPage — payment Cuenta (money account)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersApiMock.get.mockResolvedValue(order);
    paymentsApiMock.list.mockResolvedValue([]);
    returnsApiMock.listForOrder.mockResolvedValue([]);
    paymentsApiMock.record.mockResolvedValue({});
  });

  it('sends the selected account with the transfer payment payload', async () => {
    renderWithProviders(<OrderDetailPage />);

    // Wait for the order to load, then open the payment form
    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Registrar Pago/ }));

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '30' } });

    // Método → Transferencia (account select becomes editable)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Método/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }));

    // Cuenta → Banco (override the Mercado Pago default)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cuenta/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Banco' }));

    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));

    await waitFor(() => {
      expect(paymentsApiMock.record).toHaveBeenCalledWith('order-1', {
        amount: 30,
        method: 'transfer',
        account: 'bank',
      });
    });
  });

  it('locks cash payments to the Efectivo account', async () => {
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Registrar Pago/ }));

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '20' } });

    // Método stays cash (default) — Cuenta is locked to Efectivo
    const cuenta = screen.getByRole('combobox', { name: /Cuenta/ });
    expect(cuenta.getAttribute('aria-disabled')).toBe('true');
    expect(cuenta.textContent).toBe('Efectivo');

    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));

    await waitFor(() => {
      expect(paymentsApiMock.record).toHaveBeenCalledWith('order-1', {
        amount: 20,
        method: 'cash',
        account: 'cash',
      });
    });
  });
});