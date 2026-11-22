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
vi.mock('../../api/products.ts', () => ({
  productsApi: { list: vi.fn().mockResolvedValue([]), getActivePrice: vi.fn() },
}));
vi.mock('../../stores/authStore.ts', () => ({
  useAuthStore: (selector?: (state: { user: { role: string; name: string } }) => unknown) =>
    selector ? selector({ user: { role: 'admin', name: 'Admin' } }) : { user: { role: 'admin', name: 'Admin' } },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  _id: 'order-1',
  orderNumber: 'ORD-100',
  customerId: 'cust-1',
  customerName: 'Cliente Test',
  channel: 'phone',
  deliveryAddress: 'Av. Test 123',
  items: [],
  totalAmount: 100,
  status: 'in_transit',
  stockDeducted: false,
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
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OrderDetailPage — status change confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentsApiMock.list.mockResolvedValue([]);
    returnsApiMock.listForOrder.mockResolvedValue([]);
    paymentsApiMock.record.mockResolvedValue({});
    ordersApiMock.transitionStatus.mockResolvedValue(makeOrder());
  });

  it('opens the confirmation dialog without firing the transition', async () => {
    ordersApiMock.get.mockResolvedValue(makeOrder({ status: 'in_transit' }));
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Marcar Entregada/ }));

    // Dialog open + consequence shown, but nothing submitted yet.
    await screen.findByText('Marcar como Entregada');
    expect(screen.getByText(/Se descontará el stock/)).toBeTruthy();
    expect(ordersApiMock.transitionStatus).not.toHaveBeenCalled();
  });

  it('calls the transition API with the target status on confirm', async () => {
    ordersApiMock.get.mockResolvedValue(makeOrder({ status: 'in_transit' }));
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Marcar Entregada/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, marcar Entregada' }));

    await waitFor(() => {
      expect(ordersApiMock.transitionStatus).toHaveBeenCalledWith('order-1', 'delivered');
    });
  });

  it('warns that stock will be deducted when delivering', async () => {
    ordersApiMock.get.mockResolvedValue(makeOrder({ status: 'in_transit', stockDeducted: false }));
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Marcar Entregada/ }));

    await screen.findByText('Marcar como Entregada');
    expect(screen.getByText(/Se descontará el stock/)).toBeTruthy();
  });

  it('reports stock restoration when undoing a delivery', async () => {
    ordersApiMock.get.mockResolvedValue(makeOrder({ status: 'delivered', stockDeducted: true }));
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Deshacer Entrega/ }));

    await screen.findByText('Volver a En Camino');
    expect(screen.getByText(/Se repondrá el stock/)).toBeTruthy();
  });

  it('shows a neutral consequence for transitions without stock impact', async () => {
    ordersApiMock.get.mockResolvedValue(makeOrder({ status: 'pending', stockDeducted: false }));
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Marcar Asignada/ }));

    await screen.findByText('Marcar como Asignada');
    expect(screen.getByText('El pedido pasará a Asignada.')).toBeTruthy();
  });

  it('closes the dialog without calling the API when cancelled', async () => {
    ordersApiMock.get.mockResolvedValue(makeOrder({ status: 'pending', stockDeducted: false }));
    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    fireEvent.click(screen.getByRole('button', { name: /Marcar Asignada/ }));
    await screen.findByText('Marcar como Asignada');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(screen.queryByText('Marcar como Asignada')).toBeNull();
    });
    expect(ordersApiMock.transitionStatus).not.toHaveBeenCalled();
  });
});
