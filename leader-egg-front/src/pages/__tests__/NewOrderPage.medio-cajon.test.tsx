import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { NewOrderPage } from '../NewOrderPage.tsx';
import type { Customer, PriceEntry, Product } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { productsApiMock, navigateMock, authState, createOrderMock, invState } = vi.hoisted(() => ({
  productsApiMock: { list: vi.fn(), getActivePrice: vi.fn() },
  navigateMock: vi.fn(),
  authState: { role: 'admin' as string },
  createOrderMock: vi.fn(),
  // Mutable so each test can dial the available stock (in maples).
  invState: { qty: 50 },
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
    useInventory: () => ({
      data: [
        {
          _id: 'inv1',
          productId: 'p1',
          quantity: invState.qty,
          lowStockThreshold: 20,
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      ],
      isLoading: false,
      error: null,
    }),
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

const priceFor = (productId: string, unit: PriceEntry['unit'], price: number): PriceEntry => ({
  _id: `price-${productId}-${unit}`,
  productId,
  price,
  unit,
  effectiveFrom: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Renders the page, adds the single product and switches its unit. */
const renderWithUnit = async (unitLabel: string) => {
  renderWithProviders(<NewOrderPage />);
  await screen.findAllByText('Cliente Uno');

  fireEvent.click(screen.getByRole('button', { name: /Agregar Producto/i }));
  const select = await screen.findByLabelText('Producto');
  fireEvent.mouseDown(select);
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: /Blanco Chico/i }));

  fireEvent.click(screen.getByRole('button', { name: unitLabel }));
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('NewOrderPage — medio cajón unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
    invState.qty = 50;
    // p1 has an active maple AND medio cajón price; cajón has none.
    productsApiMock.getActivePrice.mockImplementation((id: string, unit?: string) => {
      if (id !== 'p1') return Promise.reject(new Error('no price'));
      if (unit === 'maple') return Promise.resolve(priceFor('p1', 'maple', 25));
      if (unit === 'medio_cajon') return Promise.resolve(priceFor('p1', 'medio_cajon', 150));
      return Promise.reject(new Error('no cajon price'));
    });
  });

  it('requires 6 maples of stock and blocks when the warehouse has less', async () => {
    invState.qty = 3;
    await renderWithUnit('Medio cajón');

    // Hint reflects the row's own stock.
    expect(await screen.findByText(/Disponible: 3 maples/i)).toBeDefined();

    // 1 medio cajón = 6 maples > 3 available → blocked.
    fireEvent.click(screen.getByRole('button', { name: /Aumentar cantidad/i }));
    expect(await screen.findByText(/Solo tenés 3 maples/i)).toBeDefined();
  });

  it('sends unit: medio_cajon in the order payload when stock is sufficient', async () => {
    await renderWithUnit('Medio cajón');

    // 1 medio cajón = 6 maples ≤ 50 available.
    fireEvent.click(screen.getByRole('button', { name: /Aumentar cantidad/i }));

    fireEvent.click(screen.getByRole('button', { name: /Confirmar y Generar Orden/i }));

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const payload = createOrderMock.mock.calls[0]?.[0];
    expect(payload.items).toEqual([{ productId: 'p1', quantity: 1, unit: 'medio_cajon' }]);
  });
});
