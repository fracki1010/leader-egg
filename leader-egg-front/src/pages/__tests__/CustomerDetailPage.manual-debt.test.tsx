import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { CustomerDetailPage } from '../CustomerDetailPage.tsx';
import type { Customer } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const {
  customersApiMock,
  accountsApiMock,
  paymentsApiMock,
  customerChargesApiMock,
} = vi.hoisted(() => ({
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
}));

vi.mock('../../api/customers.ts', () => ({ customersApi: customersApiMock }));
vi.mock('../../api/accounts.ts', () => ({ accountsApi: accountsApiMock }));
vi.mock('../../api/payments.ts', () => ({ paymentsApi: paymentsApiMock }));
vi.mock('../../api/customer-charges.ts', () => ({ customerChargesApi: customerChargesApiMock }));
vi.mock('../../components/customer/CustomerFormDialog.tsx', () => ({ CustomerFormDialog: () => null }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'cust-1' }),
  useNavigate: () => vi.fn(),
  Link: () => null,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const customer = {
  _id: 'cust-1',
  name: 'Cliente Fiado',
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
  outstandingBalance: 5000,
  totalSpent: 5000,
  orderCount: 1,
  lastOrderDate: null,
  hasPendingOrders: false,
};

const movementsWithCharge = {
  customer: {
    _id: 'cust-1',
    name: 'Cliente Fiado',
    type: 'B2C',
    status: 'active',
    creditConfig: { limit: 0, termDays: 0 },
  },
  summary: {
    outstandingBalance: 5000,
    openOrdersCount: 0,
    overdueAmount: 0,
    maxDaysOverdue: 0,
    totalSpent: 0,
    lastOrderDate: null,
  },
  movements: [
    {
      type: 'charge',
      id: 'c1',
      date: '2026-10-16T10:00:00.000Z',
      description: 'Deuda manual',
      amount: 5000,
      sign: '+',
    },
  ],
  orders: { items: [], total: 0, page: 1, limit: 50 },
  payments: [],
};

const expandMovements = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Movimientos de la cuenta/i }));
};

describe('CustomerDetailPage — crear deuda (cuenta corriente)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customersApiMock.getSummary.mockResolvedValue(summary);
    customersApiMock.getOrders.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    accountsApiMock.getMovements.mockResolvedValue(movementsWithCharge);
    customerChargesApiMock.create.mockResolvedValue({});
  });

  it('renders manual charge history rows and the current balance', async () => {
    renderWithProviders(<CustomerDetailPage />);

    await expandMovements();

    // History row labelled "Deuda manual".
    expect(await screen.findByText('Deuda manual')).toBeDefined();
    // Current balance shown as a summary metric.
    expect(screen.getAllByText(/5\.000,00/).length).toBeGreaterThanOrEqual(1);
  });

  it('sends the correct charge payload and shows the balance in the dialog', async () => {
    renderWithProviders(<CustomerDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Crear deuda/i }));

    const dialog = await screen.findByRole('dialog');
    // Current balance is visible inside the dialog.
    expect(within(dialog).getByText(/Saldo actual del cliente/i)).toBeDefined();
    expect(within(dialog).getAllByText(/5\.000,00/).length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '5000' } });

    // Motivo → Deuda manual (default) and submit.
    fireEvent.click(within(dialog).getByRole('button', { name: /Crear deuda/i }));

    await waitFor(() => {
      expect(customerChargesApiMock.create).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ type: 'charge', amount: 5000, reason: 'manual_debt' }),
      );
    });
  });

  it('sends a credit payload when tipo = Crédito', async () => {
    renderWithProviders(<CustomerDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Crear deuda/i }));
    const dialog = await screen.findByRole('dialog');

    // Tipo → Crédito.
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Tipo/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Crédito/i }));

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '2000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Acreditar/i }));

    await waitFor(() => {
      expect(customerChargesApiMock.create).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ type: 'credit', amount: 2000, reason: 'forgiveness' }),
      );
    });
  });
});
