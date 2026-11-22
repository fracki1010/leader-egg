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

/** Renders the page and adds a single product (qty 1) → order subtotal = $25. */
const renderWithOneProduct = async () => {
  renderWithProviders(<NewOrderPage />);
  await screen.findAllByText('Cliente Uno');

  fireEvent.click(screen.getByRole('button', { name: /Agregar Producto/i }));
  const select = await screen.findByLabelText('Producto');
  fireEvent.mouseDown(select);
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: /Blanco Chico/i }));

  // qty 0 → 1 (subtotal = 25).
  fireEvent.click(screen.getByRole('button', { name: /Aumentar cantidad/i }));
};

const submitOrder = () => {
  fireEvent.click(screen.getByRole('button', { name: /Confirmar y Generar Orden/i }));
};

const lastPayload = () => createOrderMock.mock.calls[0]?.[0];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('NewOrderPage — order-level bonification', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
    productsApiMock.getActivePrice.mockImplementation((id: string, unit?: string) => {
      if (id === 'p1' && unit === 'maple') return Promise.resolve(priceFor('p1', 25));
      return Promise.reject(new Error('no price'));
    });
  });

  it('computes a fixed-amount discount live and submits it', async () => {
    await renderWithOneProduct();

    const input = await screen.findByLabelText(/Valor de bonificación/i);
    fireEvent.change(input, { target: { value: '5' } });

    // Live discount + discounted total ($25 − $5 = $20).
    expect((await screen.findAllByText('-$ 5,00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$ 20,00').length).toBeGreaterThan(0);

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(lastPayload().bonification).toEqual({ type: 'amount', value: 5 });
  });

  it('computes a percentage discount live and submits it', async () => {
    await renderWithOneProduct();

    fireEvent.click(within(screen.getByRole('group', { name: /Tipo de bonificación/i })).getByRole('button', { name: /Porcentaje/i }));
    const input = await screen.findByLabelText(/Valor de bonificación/i);
    fireEvent.change(input, { target: { value: '10' } });

    // 10% of $25 = $2,50 → total $22,50.
    expect((await screen.findAllByText('-$ 2,50')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$ 22,50').length).toBeGreaterThan(0);
    expect(screen.getByText(/Bonificación \(10%\)/)).toBeDefined();

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(lastPayload().bonification).toEqual({ type: 'percent', value: 10 });
  });

  it('omits the bonification when the field is empty', async () => {
    await renderWithOneProduct();

    submitOrder();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(lastPayload().bonification).toBeUndefined();
  });

  it('blocks submit while the amount exceeds the subtotal', async () => {
    await renderWithOneProduct();

    const input = await screen.findByLabelText(/Valor de bonificación/i);
    fireEvent.change(input, { target: { value: '30' } });

    expect(await screen.findByText(/No puede superar el subtotal/i)).toBeDefined();

    submitOrder();

    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('blocks submit while the percentage exceeds 100', async () => {
    await renderWithOneProduct();

    fireEvent.click(within(screen.getByRole('group', { name: /Tipo de bonificación/i })).getByRole('button', { name: /Porcentaje/i }));
    const input = await screen.findByLabelText(/Valor de bonificación/i);
    fireEvent.change(input, { target: { value: '150' } });

    expect(await screen.findByText(/no puede superar 100%/i)).toBeDefined();

    submitOrder();

    expect(createOrderMock).not.toHaveBeenCalled();
  });
});
