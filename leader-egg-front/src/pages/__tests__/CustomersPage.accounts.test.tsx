import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { CustomersPage } from '../CustomersPage.tsx';
import type { AccountRow, AccountsFilters } from '../../api/accounts.ts';
import type { CustomerListFilters } from '../../api/customers.ts';
import type { Customer, DashboardSummary } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { customersApiMock, accountsApiMock, ordersApiMock, dashboardApiMock, navigateMock } = vi.hoisted(() => ({
  customersApiMock: {
    listFiltered: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    remove: vi.fn(),
  },
  accountsApiMock: { list: vi.fn(), getMovements: vi.fn() },
  ordersApiMock: { getCustomerOutstanding: vi.fn() },
  dashboardApiMock: { getSummary: vi.fn(), getAlerts: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/customers.ts', () => ({ customersApi: customersApiMock }));
vi.mock('../../api/accounts.ts', () => ({ accountsApi: accountsApiMock }));
vi.mock('../../api/orders.ts', () => ({ ordersApi: ordersApiMock }));
vi.mock('../../api/dashboard.ts', () => ({ dashboardApi: dashboardApiMock }));
vi.mock('../../components/customer/CustomerFormDialog.tsx', () => ({ CustomerFormDialog: () => null }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const customerA: Customer = {
  _id: 'c1',
  name: 'Panadería Sol',
  type: 'B2B',
  phone: '+5491100000001',
  address: 'Av. Siempreviva 742',
  addressDetail: { neighborhood: 'Centro' },
  creditConfig: { limit: 100000, termDays: 30 },
  openingDebt: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const customerB: Customer = {
  _id: 'c2',
  name: 'Kiosco Luna',
  type: 'B2C',
  phone: '+5491100000002',
  address: 'Calle Falsa 123',
  creditConfig: { limit: 0, termDays: 0 },
  openingDebt: 0,
  status: 'active',
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

const accountA: AccountRow = {
  customerId: 'c1',
  customerName: 'Panadería Sol',
  type: 'B2B',
  outstandingBalance: 15000,
  openOrdersCount: 2,
  overdueAmount: 5000,
  maxDaysOverdue: 10,
  hasPendingOrders: true,
  lastOrderDate: '2026-03-10T00:00:00Z',
  totalSpent: 50000,
  creditLimit: 100000,
  creditUsedPct: 15,
  status: 'active',
};

const accountB: AccountRow = {
  customerId: 'c2',
  customerName: 'Kiosco Luna',
  type: 'B2C',
  outstandingBalance: 0,
  openOrdersCount: 0,
  overdueAmount: 0,
  maxDaysOverdue: 0,
  hasPendingOrders: false,
  lastOrderDate: null,
  totalSpent: 0,
  creditLimit: 0,
  creditUsedPct: 0,
  status: 'active',
};

const dashboardSummary = {
  porCobrar: 15000,
  clientesDeudores: 1,
  cobradoHoy: 8000,
  vencidas: { total: 5000, count: 1 },
} as unknown as DashboardSummary;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CustomersPage — merged customer accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    customersApiMock.listFiltered.mockImplementation(async (filters: CustomerListFilters = {}) => {
      let items = [customerA, customerB];
      if (filters.type) items = items.filter((c) => c.type === filters.type);
      return { items, total: items.length, page: filters.page ?? 1, limit: filters.limit ?? 20 };
    });

    accountsApiMock.list.mockImplementation(async (filters: AccountsFilters = {}) => {
      let items = [accountA, accountB];
      if (filters.onlyDebtors) items = items.filter((a) => a.outstandingBalance > 0);
      if (filters.overdueOnly) items = items.filter((a) => a.overdueAmount > 0);
      return { items, total: items.length, page: filters.page ?? 1, limit: filters.limit ?? 50 };
    });

    ordersApiMock.getCustomerOutstanding.mockResolvedValue({
      customerId: 'c1',
      outstandingBalance: 15000,
      orderCount: 2,
    });
    dashboardApiMock.getSummary.mockResolvedValue(dashboardSummary);
  });

  it('renders the merged account stats and compact customer rows', async () => {
    renderWithProviders(<CustomersPage />);

    const solRow = await screen.findByRole('button', { name: 'Ver cliente Panadería Sol' });
    expect(screen.getByRole('button', { name: 'Ver cliente Kiosco Luna' })).toBeDefined();

    // Header stats merged from the old Cuentas screen.
    expect(screen.getByText('Total a Cobrar')).toBeDefined();
    expect(screen.getByText('Deudores')).toBeDefined();
    expect(screen.getAllByText('Vencido').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Cobrado Hoy')).toBeDefined();

    // Minimal row: name + type chip + saldo chip (no account columns).
    expect(within(solRow).getByText('Panadería Sol')).toBeDefined();
    expect(within(solRow).getByText('B2B')).toBeDefined();
    expect(within(solRow).getByText('$ 15.000')).toBeDefined();
    expect(within(solRow).queryByText('Último pedido')).toBeNull();
    expect(within(solRow).queryByText(/Crédito/)).toBeNull();

    // Zero-balance customer shows the "Al día" chip.
    const lunaRow = screen.getByRole('button', { name: 'Ver cliente Kiosco Luna' });
    expect(within(lunaRow).getByText('Al día')).toBeDefined();
  });

  it('navigates to the customer detail when a row is tapped', async () => {
    renderWithProviders(<CustomersPage />);

    const row = await screen.findByRole('button', { name: 'Ver cliente Panadería Sol' });
    fireEvent.click(row);

    expect(navigateMock).toHaveBeenCalledWith('/customers/c1');
  });

  it('does not render the former inline per-card actions', async () => {
    renderWithProviders(<CustomersPage />);

    await screen.findByText('Panadería Sol');

    expect(screen.queryByRole('button', { name: /Ver cuenta/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Crear deuda/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pedido/i })).toBeNull();
    expect(screen.queryByLabelText(/WhatsApp/i)).toBeNull();
    expect(screen.queryByLabelText(/Llamar/i)).toBeNull();
  });

  it('filters by "Con saldo" through the accounts endpoint', async () => {
    renderWithProviders(<CustomersPage />);

    await screen.findByText('Kiosco Luna');

    fireEvent.click(screen.getByRole('button', { name: 'Con saldo' }));

    await waitFor(() => {
      expect(accountsApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ onlyDebtors: true }));
    });

    // The zero-balance customer drops out of the account view.
    await waitFor(() => {
      expect(screen.queryByText('Kiosco Luna')).toBeNull();
    });
    expect(screen.getByText('Panadería Sol')).toBeDefined();
  });

  it('sorts by balance through the accounts endpoint', async () => {
    renderWithProviders(<CustomersPage />);

    await screen.findByText('Panadería Sol');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Ordenar/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Por saldo' }));

    await waitFor(() => {
      expect(accountsApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ sort: 'balance' }));
    });
  });
});
