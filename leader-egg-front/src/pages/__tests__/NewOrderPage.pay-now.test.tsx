import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { NewOrderPage } from '../NewOrderPage.tsx';
import type { Customer, InventoryItem, PriceEntry, Product } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { productsApiMock, navigateMock, authState, createOrderMock } = vi.hoisted(() => ({
  productsApiMock: { list: vi.fn(), getActivePrice: vi.fn() },
  navigateMock: vi.fn(),
  authState: { role: 'admin' as string },
  createOrderMock: vi.fn(),
}));

vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));
vi.mock('../../api/geocode.ts', () => ({ geocode: vi.fn(), reverseGeocode: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  // Preselect a customer so the form is submittable without driving the picker.
  useSearchParams: () => [new URLSearchParams('customer=c1'), vi.fn()],
}));
vi.mock('../../stores/authStore.ts', () => ({
  useAuthStore: () => ({ user: { role: authState.role, name: 'Test' } }),
}));

vi.mock('../../hooks/queries/index.ts', async () => {
  const actual = await vi.importActual('../../hooks/queries/index.ts');
  return {
    ...actual,
    useCustomers: () => ({ data: customers, isLoading: false, error: null }),
    useProducts: () => ({ data: products, isLoading: false, error: null }),
    useActivePromotions: () => ({ data: [], isLoading: false, error: null }),
    useInventory: () => ({ data: inventory, isLoading: false, error: null }),
    useCustomerOutstanding: () => ({ data: null, isLoading: false, error: null }),
  };
});

vi.mock('../../hooks/mutations/index.ts', () => ({
  useCreateOrder: () => ({ mutate: createOrderMock, isPending: false }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const customers: Customer[] = [
  {
    _id: 'c1',
    name: 'Cliente Uno',
    type: 'B2C',
    phone: '555-0000',
    address: 'Calle Falsa 123',
    creditConfig: { limit: 0, termDays: 0 },
    openingDebt: 0,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const products: Product[] = [
  {
    _id: 'p1',
    variety: 'blanco',
    caliber: 'chico',
    displayName: 'Blanco Chico',
    eggsPerMaple: 30,
    maplesPerCajon: 12,
    lowStockThreshold: 20,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const inventory: InventoryItem[] = [
  { _id: 'inv1', productId: 'p1', quantity: 50, lowStockThreshold: 20, lastUpdated: '2026-01-01T00:00:00Z' },
];

const priceFor = (productId: string, price: number): PriceEntry => ({
  _id: `price-${productId}`,
  productId,
  price,
  unit: 'maple',
  effectiveFrom: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Renders the page and adds a single product (qty 1) → order total = $25. */
const renderWithOneProduct = async () => {
  renderWithProviders(<NewOrderPage />);
  // Wait for the preselected customer card, then add the one sellable product.
  await screen.findAllByText('Cliente Uno');

  fireEvent.click(screen.getByRole('button', { name: /Agregar Producto/i }));
  const select = await screen.findByLabelText('Producto');
  fireEvent.mouseDown(select);
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: /Blanco Chico/i }));

  // qty 0 → 1 (total = 25).
  fireEvent.click(screen.getByRole('button', { name: /Aumentar cantidad/i }));
};

const submitOrder = () => {
  fireEvent.click(screen.getByRole('button', { name: /Confirmar y Generar Orden/i }));
};

const lastPayload = () => createOrderMock.mock.calls[0]?.[0];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('NewOrderPage — inline "Paga ahora" / "Queda pendiente"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
    productsApiMock.getActivePrice.mockImplementation((id: string, unit?: string) => {
      if (id === 'p1' && unit === 'maple') return Promise.resolve(priceFor('p1', 25));
      return Promise.reject(new Error('no price'));
    });
  });

  it('renders both options with "Queda pendiente" as the default', async () => {
    await renderWithOneProduct();

    const payNow = screen.getByRole('button', { name: 'Paga ahora' });
    const pending = screen.getByRole('button', { name: 'Queda pendiente' });

    expect(pending.getAttribute('aria-pressed')).toBe('true');
    expect(payNow.getAttribute('aria-pressed')).toBe('false');
    // Pending mode keeps the 4 preference sub-modes and shows no payment editor.
    expect(screen.queryByLabelText(/Monto/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Efectivo' })).toBeDefined();
  });

  it('submits without payments when "Queda pendiente" is kept', async () => {
    await renderWithOneProduct();

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.initialPayments).toBeUndefined();
    expect(payload.initialPayment).toBeUndefined();
    expect(payload.paymentPreference).toBe('cash');
    expect(payload.items).toEqual([{ productId: 'p1', quantity: 1, unit: 'maple' }]);
  });

  it('"Paga ahora" defaults the amount to the order total and submits initialPayments', async () => {
    await renderWithOneProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Paga ahora' }));

    // Editor is shown with the single line prefilled to the total ($25).
    const amount = await screen.findByLabelText(/Monto/);
    expect((amount as HTMLInputElement).value).toBe('25');

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.initialPayments).toEqual([{ method: 'cash', account: 'cash', amount: 25 }]);
    expect(payload.paymentPreference).toBe('cash');
  });

  it('supports a partial "Paga ahora" and shows the pending remainder', async () => {
    await renderWithOneProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Paga ahora' }));
    fireEvent.change(await screen.findByLabelText(/Monto/), { target: { value: '10' } });

    // Live summary of the resulting split.
    expect(screen.getByText(/Queda \$ 15,00 pendiente/)).toBeDefined();

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.initialPayments).toEqual([{ method: 'cash', account: 'cash', amount: 10 }]);
    expect(payload.paymentPreference).toBe('partial');
  });

  it('blocks a payment larger than the total with a clear message', async () => {
    await renderWithOneProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Paga ahora' }));
    fireEvent.change(await screen.findByLabelText(/Monto/), { target: { value: '30' } });

    // Inline error is visible immediately.
    expect((await screen.findAllByText(/no puede superar el total/)).length).toBeGreaterThan(0);

    submitOrder();

    // Submit is blocked before hitting the API.
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('includes the selected money account in the payment payload', async () => {
    await renderWithOneProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Paga ahora' }));
    await screen.findByLabelText(/Monto/);

    // Método → Transferencia (account auto-derives to Mercado Pago)…
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Método/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }));

    // …then override Cuenta → Banco.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cuenta/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Banco' }));

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.initialPayments).toEqual([{ method: 'transfer', account: 'bank', amount: 25 }]);
    expect(payload.paymentPreference).toBe('transfer');
  });

  it('adds and removes a second payment line', async () => {
    await renderWithOneProduct();

    fireEvent.click(screen.getByRole('button', { name: 'Paga ahora' }));
    await screen.findByLabelText(/Monto/);

    expect(screen.getAllByLabelText(/Monto/)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Agregar método/i }));
    expect(screen.getAllByLabelText(/Monto/)).toHaveLength(2);

    const removeButtons = screen.getAllByRole('button', { name: 'Quitar método' });
    fireEvent.click(removeButtons[removeButtons.length - 1]!);
    expect(screen.getAllByLabelText(/Monto/)).toHaveLength(1);
  });
});
