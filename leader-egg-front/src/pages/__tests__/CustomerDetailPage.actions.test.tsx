import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { CustomerDetailPage } from '../CustomerDetailPage.tsx';
import type { Customer, Order } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { customersApiMock, accountsApiMock, paymentsApiMock, customerChargesApiMock, navigateMock } = vi.hoisted(() => ({
  customersApiMock: {
    getSummary: vi.fn(),
    getOrders: vi.fn(),
    listFiltered: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
  },
  accountsApiMock: { getMovements: vi.fn(), list: vi.fn() },
  paymentsApiMock: {
    record: vi.fn(),
    recordCustomerPayment: vi.fn(),
    list: vi.fn(),
    getReceipt: vi.fn(),
  },
  customerChargesApiMock: { create: vi.fn(), list: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/customers.ts', () => ({ customersApi: customersApiMock }));
vi.mock('../../api/accounts.ts', () => ({ accountsApi: accountsApiMock }));
vi.mock('../../api/payments.ts', () => ({ paymentsApi: paymentsApiMock }));
vi.mock('../../api/customer-charges.ts', () => ({ customerChargesApi: customerChargesApiMock }));
vi.mock('../../components/customer/CustomerFormDialog.tsx', () => ({ CustomerFormDialog: () => null }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'cust-1' }),
  useNavigate: () => navigateMock,
  Link: () => null,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const customer = {
  _id: 'cust-1',
  name: 'Panadería Sol',
  type: 'B2B',
  phone: '+5491100000001',
  address: 'Av. Siempreviva 742',
  creditConfig: { limit: 100000, termDays: 30 },
  openingDebt: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as Customer;

const order = (
  id: string,
  orderNumber: string,
  createdAt: string,
  balance: number,
): Order => ({
  _id: id,
  orderNumber,
  createdAt,
  balance,
  totalAmount: balance,
  paidAmount: 0,
  paymentStatus: 'pending',
  status: 'delivered',
  customerId: 'cust-1',
  items: [{ productName: 'Maple A', quantity: 10, mapleQty: 10 }],
} as unknown as Order);

const openOrders = [
  order('ord-1', 'ORD-001', '2026-10-10T10:00:00.000Z', 8000),
  order('ord-2', 'ORD-002', '2026-10-12T10:00:00.000Z', 12000),
];

const summary = {
  customer,
  outstandingBalance: 25000,
  totalSpent: 50000,
  orderCount: 3,
  lastOrderDate: '2026-10-15T10:00:00.000Z',
  hasPendingOrders: true,
};

const movements = {
  customer,
  summary: {
    outstandingBalance: 25000,
    openOrdersCount: 2,
    overdueAmount: 0,
    maxDaysOverdue: 0,
    totalSpent: 50000,
    lastOrderDate: '2026-10-15T10:00:00.000Z',
  },
  movements: [],
  orders: { items: openOrders, total: 2, page: 1, limit: 50 },
  payments: [],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CustomerDetailPage — account action hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customersApiMock.getSummary.mockResolvedValue(summary);
    customersApiMock.getOrders.mockResolvedValue({ items: openOrders, total: 2, page: 1, limit: 50 });
    accountsApiMock.getMovements.mockResolvedValue(movements);
    paymentsApiMock.recordCustomerPayment.mockResolvedValue({
      applied: 8000,
      unapplied: 0,
      allocations: [
        {
          orderId: 'ord-1',
          orderNumber: 'ORD-001',
          date: '2026-10-10T10:00:00.000Z',
          applied: 8000,
          balanceBefore: 8000,
          balanceAfter: 0,
        },
      ],
    });
    customerChargesApiMock.create.mockResolvedValue({});
  });

  it('renders the account action buttons', async () => {
    renderWithProviders(<CustomerDetailPage />);

    expect(await screen.findByRole('button', { name: /Registrar pago/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Crear deuda/i })).toBeDefined();
    // The separate statement page is gone — no navigation button remains.
    expect(screen.queryByRole('button', { name: /Ver estado de cuenta/i })).toBeNull();
  });

  it('opens the FIFO payment dialog and submits a customer-level payment', async () => {
    renderWithProviders(<CustomerDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Registrar pago/i }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Se aplicará a las órdenes más antiguas primero/i)).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText(/Monto/), { target: { value: '8000' } });

    // Oldest open order is previewed first (FIFO).
    await waitFor(() => {
      expect(within(dialog).getByText(/#ORD-001/)).toBeDefined();
    });
    expect(within(dialog).getByText('(saldo completo)')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: /Registrar pago/i }));

    await waitFor(() => {
      expect(paymentsApiMock.recordCustomerPayment).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ amount: 8000, method: 'cash' }),
      );
    });
  });

  it('opens the "Crear deuda" dialog and creates a manual charge', async () => {
    renderWithProviders(<CustomerDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Crear deuda/i }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Saldo actual del cliente/i)).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText(/Monto/), { target: { value: '5000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Crear deuda/i }));

    await waitFor(() => {
      expect(customerChargesApiMock.create).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ type: 'charge', amount: 5000, reason: 'manual_debt' }),
      );
    });
  });

  it('renders the account movements section collapsed and expands to the empty state', async () => {
    renderWithProviders(<CustomerDetailPage />);

    const toggle = await screen.findByRole('button', { name: /Movimientos de la cuenta/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Sin movimientos')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Sin movimientos')).toBeDefined();
  });
});
