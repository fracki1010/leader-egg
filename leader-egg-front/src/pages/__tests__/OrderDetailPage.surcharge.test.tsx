import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { OrderDetailPage } from '../OrderDetailPage.tsx';
import type { Order } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { ordersApiMock, paymentsApiMock, returnsApiMock } = vi.hoisted(() => ({
  ordersApiMock: { get: vi.fn(), transitionStatus: vi.fn() },
  paymentsApiMock: { record: vi.fn(), list: vi.fn() },
  returnsApiMock: { listForOrder: vi.fn() },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'order-1' }),
  useNavigate: () => vi.fn(),
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

const baseOrder: Order = {
  _id: 'order-1',
  orderNumber: 'ORD-100',
  customerId: 'cust-1',
  customerName: 'Cliente Test',
  channel: 'phone',
  deliveryAddress: 'Av. Test 123',
  items: [],
  subtotal: 100,
  bonification: null,
  surcharge: { type: 'percent', value: 10, amount: 10 },
  totalAmount: 110,
  status: 'pending',
  paymentPreference: 'cash',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 110,
  returnedAmount: 0,
  dueDate: null,
  routeId: null,
  routeStopId: null,
  auditLog: [],
  createdAt: '2026-10-04T12:00:00Z',
  updatedAt: '2026-10-04T12:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OrderDetailPage — surcharge row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentsApiMock.list.mockResolvedValue([]);
    returnsApiMock.listForOrder.mockResolvedValue([]);
  });

  it('shows the surcharge with its type and surcharged total', async () => {
    ordersApiMock.get.mockResolvedValue(baseOrder);

    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    expect(screen.getByText('Recargo (10%)')).toBeDefined();
    expect(screen.getByText('+$ 10,00')).toBeDefined();
    expect(screen.getByText('Subtotal')).toBeDefined();
    expect(screen.getAllByText('$ 110,00').length).toBeGreaterThan(0);
  });

  it('shows both the bonification and the surcharge rows', async () => {
    ordersApiMock.get.mockResolvedValue({
      ...baseOrder,
      bonification: { type: 'amount', value: 5, amount: 5 },
      surcharge: { type: 'percent', value: 10, amount: 10 },
      totalAmount: 105,
      balance: 105,
    });

    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    expect(screen.getByText('Bonificación (monto fijo)')).toBeDefined();
    expect(screen.getByText('−$ 5,00')).toBeDefined();
    expect(screen.getByText('Recargo (10%)')).toBeDefined();
    expect(screen.getByText('+$ 10,00')).toBeDefined();
    expect(screen.getAllByText('$ 105,00').length).toBeGreaterThan(0);
  });

  it('hides the surcharge row when the order has none', async () => {
    ordersApiMock.get.mockResolvedValue({
      ...baseOrder,
      subtotal: 110,
      surcharge: null,
      totalAmount: 110,
    });

    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    expect(screen.queryByText(/Recargo/)).toBeNull();
  });
});
