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
  bonification: { type: 'percent', value: 10, amount: 10 },
  totalAmount: 90,
  status: 'pending',
  paymentPreference: 'cash',
  paymentStatus: 'unpaid',
  paidAmount: 0,
  balance: 90,
  returnedAmount: 0,
  dueDate: null,
  routeId: null,
  routeStopId: null,
  auditLog: [],
  createdAt: '2026-10-04T12:00:00Z',
  updatedAt: '2026-10-04T12:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('OrderDetailPage — bonification row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentsApiMock.list.mockResolvedValue([]);
    returnsApiMock.listForOrder.mockResolvedValue([]);
  });

  it('shows the bonification with its type and discounted total', async () => {
    ordersApiMock.get.mockResolvedValue(baseOrder);

    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    expect(screen.getByText('Bonificación (10%)')).toBeDefined();
    expect(screen.getByText('−$ 10,00')).toBeDefined();
    expect(screen.getByText('Subtotal')).toBeDefined();
    expect(screen.getAllByText('$ 90,00').length).toBeGreaterThan(0);
  });

  it('hides the bonification row when the order has no discount', async () => {
    ordersApiMock.get.mockResolvedValue({
      ...baseOrder,
      subtotal: 90,
      bonification: null,
      totalAmount: 90,
    });

    renderWithProviders(<OrderDetailPage />);

    await screen.findByText('Orden #ORD-100');
    expect(screen.queryByText(/Bonificación/)).toBeNull();
  });
});
