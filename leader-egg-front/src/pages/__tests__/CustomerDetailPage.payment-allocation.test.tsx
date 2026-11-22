import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { CustomerDetailPage } from '../CustomerDetailPage.tsx';
import type { Customer } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { customersApiMock, accountsApiMock, paymentsApiMock } = vi.hoisted(() => ({
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
}));

vi.mock('../../api/customers.ts', () => ({ customersApi: customersApiMock }));
vi.mock('../../api/accounts.ts', () => ({ accountsApi: accountsApiMock }));
vi.mock('../../api/payments.ts', () => ({ paymentsApi: paymentsApiMock }));
vi.mock('../../components/customer/CustomerFormDialog.tsx', () => ({ CustomerFormDialog: () => null }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'cust-1' }),
  useNavigate: () => vi.fn(),
  Link: () => null,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const customer = {
  _id: 'cust-1',
  name: 'Cliente FIFO',
  type: 'B2C',
  phone: '',
  address: '',
  creditConfig: { limit: 0, termDays: 0 },
  openingDebt: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as Customer;

const summary = {
  customer,
  outstandingBalance: 25000,
  totalSpent: 25000,
  orderCount: 3,
  lastOrderDate: '2026-10-15T10:00:00.000Z',
  hasPendingOrders: true,
};

const order = (
  id: string,
  orderNumber: string,
  createdAt: string,
  balance: number,
  totalAmount: number,
) => ({
  _id: id,
  orderNumber,
  createdAt,
  balance,
  totalAmount,
  paidAmount: totalAmount - balance,
  paymentStatus: balance === 0 ? 'paid' : 'partial',
});

/** Deliberately NOT sorted — the dialog must sort by createdAt (oldest first). */
const movementsFixture = {
  customer: {
    _id: 'cust-1',
    name: 'Cliente FIFO',
    type: 'B2C',
    status: 'active',
    creditConfig: { limit: 0, termDays: 0 },
  },
  summary: {
    outstandingBalance: 25000,
    openOrdersCount: 3,
    overdueAmount: 0,
    maxDaysOverdue: 0,
    totalSpent: 25000,
    lastOrderDate: '2026-10-15T10:00:00.000Z',
  },
  movements: [],
  orders: {
    items: [
      order('ord-3', 'ORD-003', '2026-10-15T10:00:00.000Z', 5000, 5000),
      order('ord-1', 'ORD-001', '2026-10-10T10:00:00.000Z', 8000, 8000),
      order('ord-2', 'ORD-002', '2026-10-12T10:00:00.000Z', 12000, 12000),
    ],
    total: 3,
    page: 1,
    limit: 50,
  },
  payments: [],
};

const openPaymentDialog = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Registrar pago/i }));
  return screen.findByRole('dialog');
};

const setAmount = (amount: string) => {
  fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: amount } });
};

describe('CustomerDetailPage — customer-level payment (FIFO allocation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customersApiMock.getSummary.mockResolvedValue(summary);
    customersApiMock.getOrders.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    accountsApiMock.getMovements.mockResolvedValue(movementsFixture);
    paymentsApiMock.recordCustomerPayment.mockResolvedValue({
      applied: 12000,
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
        {
          orderId: 'ord-2',
          orderNumber: 'ORD-002',
          date: '2026-10-12T10:00:00.000Z',
          applied: 4000,
          balanceBefore: 12000,
          balanceAfter: 8000,
        },
      ],
    });
  });

  it('shows the live allocation preview oldest-first, including the unassigned remainder', async () => {
    renderWithProviders(<CustomerDetailPage />);
    const dialog = await openPaymentDialog();

    // The per-order selector is gone.
    expect(within(dialog).queryByLabelText(/Aplicar a/i)).toBeNull();

    setAmount('12000');

    const rows = within(dialog).getAllByText(/#ORD-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('ORD-001');
    expect(rows[0]!.textContent).toContain('10/10');
    expect(rows[1]!.textContent).toContain('ORD-002');
    expect(rows[1]!.textContent).toContain('12/10');

    // Full vs partial labels and amounts.
    expect(within(dialog).getByText('(saldo completo)')).toBeDefined();
    expect(within(dialog).getByText('(parcial)')).toBeDefined();
    expect(within(dialog).getByText(/\$\s*8\.000,00/)).toBeDefined();
    expect(within(dialog).getByText(/\$\s*4\.000,00/)).toBeDefined();

    // Third (newest) order is not part of the preview.
    expect(within(dialog).queryByText(/ORD-003/)).toBeNull();

    // Remainder line.
    expect(within(dialog).getByText('Sin asignar')).toBeDefined();
    expect(within(dialog).getAllByText(/\$\s*0,00/).length).toBeGreaterThanOrEqual(1);
  });

  it('blocks submit and shows an inline error when the amount exceeds the total open debt', async () => {
    renderWithProviders(<CustomerDetailPage />);
    const dialog = await openPaymentDialog();

    setAmount('26000');

    expect(await within(dialog).findByText(/supera la deuda total/i)).toBeDefined();

    const submit = within(dialog).getByRole('button', { name: /Registrar pago/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(submit);
    expect(paymentsApiMock.recordCustomerPayment).not.toHaveBeenCalled();
  });

  it('submits the customer-level payload to the new endpoint (not the per-order one)', async () => {
    renderWithProviders(<CustomerDetailPage />);
    const dialog = await openPaymentDialog();

    setAmount('12000');
    fireEvent.click(within(dialog).getByRole('button', { name: /Registrar pago/i }));

    await waitFor(() => {
      expect(paymentsApiMock.recordCustomerPayment).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ amount: 12000, method: 'cash' }),
      );
    });
    expect(paymentsApiMock.record).not.toHaveBeenCalled();
  });
});
