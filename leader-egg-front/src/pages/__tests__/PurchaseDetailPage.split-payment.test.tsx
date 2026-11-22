import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { PurchaseDetailPage } from '../PurchaseDetailPage.tsx';
import type { PurchaseDetail } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { purchasesApiMock, suppliersApiMock, productsApiMock, navigateMock } = vi.hoisted(() => ({
  purchasesApiMock: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deliver: vi.fn(),
    cancel: vi.fn(),
    recordPayment: vi.fn(),
    remove: vi.fn(),
  },
  suppliersApiMock: { list: vi.fn() },
  productsApiMock: { list: vi.fn(), getActivePrice: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'purchase-1' }),
  useNavigate: () => navigateMock,
}));
vi.mock('../../api/purchases.ts', () => ({ purchasesApi: purchasesApiMock }));
vi.mock('../../api/suppliers.ts', () => ({ suppliersApi: suppliersApiMock }));
vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const detail: PurchaseDetail = {
  purchaseNumber: 'PUR-1',
  supplierId: 'sup-1',
  supplierName: 'Granja Test',
  date: '2026-10-04T12:00:00Z',
  items: [],
  totalCost: 200,
  notes: '',
  status: 'delivered',
  deliveredAt: '2026-10-04T12:00:00Z',
  paymentMethod: null,
  account: null,
  paymentStatus: 'unpaid',
  paidAmount: 0,
  payments: [],
  balance: 200,
  createdBy: 'admin',
  createdAt: '2026-10-04T12:00:00Z',
  updatedAt: '2026-10-04T12:00:00Z',
};

/** The last "Registrar pago" button is the dialog action (header keeps its own). */
const submitPayment = () => {
  const buttons = screen.getAllByRole('button', { name: /Registrar pago/i });
  fireEvent.click(buttons[buttons.length - 1]!);
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PurchaseDetailPage — split payment dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purchasesApiMock.get.mockResolvedValue(detail);
    purchasesApiMock.recordPayment.mockResolvedValue({});
    suppliersApiMock.list.mockResolvedValue([]);
    productsApiMock.list.mockResolvedValue([]);
    productsApiMock.getActivePrice.mockResolvedValue({ price: 25 });
  });

  it('records a split payload with one line per method (cash 50 + MP 50)', async () => {
    renderWithProviders(<PurchaseDetailPage />);

    await screen.findByText('Compra PUR-1');
    fireEvent.click(screen.getByRole('button', { name: /Registrar pago/i }));

    // First line: cash 50 (default method cash → account cash)
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '50' } });

    // Add a second line and pay 50 by transfer → Mercado Pago
    fireEvent.click(screen.getByRole('button', { name: /Agregar método/i }));
    const amounts = screen.getAllByLabelText(/Monto/);
    expect(amounts).toHaveLength(2);
    fireEvent.change(amounts[1]!, { target: { value: '50' } });

    const methodCombos = screen.getAllByRole('combobox', { name: /Método/ });
    fireEvent.mouseDown(methodCombos[1]!);
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }));

    submitPayment();

    await waitFor(() => {
      expect(purchasesApiMock.recordPayment).toHaveBeenCalledWith('purchase-1', {
        payments: [
          { method: 'cash', account: 'cash', amount: 50 },
          { method: 'transfer', account: 'mp', amount: 50 },
        ],
      });
    });
  });

  it('blocks submit and shows an error when Σ(lines) exceeds the balance', async () => {
    renderWithProviders(<PurchaseDetailPage />);

    await screen.findByText('Compra PUR-1');
    fireEvent.click(screen.getByRole('button', { name: /Registrar pago/i }));

    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '300' } }); // balance is 200
    submitPayment();

    expect(await screen.findByText(/supera el saldo pendiente/i)).toBeTruthy();
    expect(purchasesApiMock.recordPayment).not.toHaveBeenCalled();
  });

  it('removes a line but never drops below one', async () => {
    renderWithProviders(<PurchaseDetailPage />);

    await screen.findByText('Compra PUR-1');
    fireEvent.click(screen.getByRole('button', { name: /Registrar pago/i }));

    // Single line → its remove button is disabled
    expect((screen.getByRole('button', { name: /Quitar método/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Agregar método/i }));
    expect(screen.getAllByLabelText(/Monto/)).toHaveLength(2);

    // Remove the second line → back to a single row
    fireEvent.click(screen.getAllByRole('button', { name: /Quitar método/i })[1]!);
    expect(screen.getAllByLabelText(/Monto/)).toHaveLength(1);
  });

  it('renders the recorded payments history', async () => {
    purchasesApiMock.get.mockResolvedValue({
      ...detail,
      paidAmount: 100,
      balance: 100,
      paymentStatus: 'partial',
      payments: [
        { method: 'cash', account: 'cash', amount: 50, date: '2026-10-04T12:00:00Z', groupId: 'g1' },
        { method: 'transfer', account: 'mp', amount: 50, date: '2026-10-04T12:00:00Z', groupId: 'g1' },
      ],
    } satisfies PurchaseDetail);

    renderWithProviders(<PurchaseDetailPage />);

    await screen.findByText('Historial de pagos');
    expect(screen.getByText('Mercado Pago')).toBeTruthy();
  });
});
