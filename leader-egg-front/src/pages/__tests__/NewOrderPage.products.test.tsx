import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { NewOrderPage } from '../NewOrderPage.tsx';
import type { InventoryItem, PriceEntry, Product } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { productsApiMock, navigateMock, authState } = vi.hoisted(() => ({
  productsApiMock: { list: vi.fn(), getActivePrice: vi.fn() },
  navigateMock: vi.fn(),
  // Role is mutable so a test can switch away from admin (preventa is admin-only).
  authState: { role: 'admin' as string },
}));

vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));
vi.mock('../../api/geocode.ts', () => ({ geocode: vi.fn(), reverseGeocode: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('../../stores/authStore.ts', () => ({
  useAuthStore: () => ({ user: { role: authState.role, name: 'Test' } }),
}));

// Read hooks are stubbed: the page only needs products, prices and stock here.
vi.mock('../../hooks/queries/index.ts', async () => {
  const actual = await vi.importActual('../../hooks/queries/index.ts');
  return {
    ...actual,
    useCustomers: () => ({ data: [], isLoading: false, error: null }),
    useProducts: () => ({ data: products, isLoading: false, error: null }),
    useActivePromotions: () => ({ data: [], isLoading: false, error: null }),
    useInventory: () => ({ data: inventory, isLoading: false, error: null }),
    useCustomerOutstanding: () => ({ data: null, isLoading: false, error: null }),
  };
});

vi.mock('../../hooks/mutations/index.ts', () => ({
  useCreateOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const product = (
  id: string,
  variety: Product['variety'],
  caliber: Product['caliber'],
  displayName: string,
): Product => ({
  _id: id,
  variety,
  caliber,
  displayName,
  eggsPerMaple: 30,
  maplesPerCajon: 12,
  lowStockThreshold: 20,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const products: Product[] = [
  product('p1', 'blanco', 'chico', 'Blanco Chico'),
  product('p2', 'castaño', 'chico', 'Castaño Chico'),
  product('p3', 'blanco', 'surtido', 'Blanco Surtido'),
];

// p1: price + low stock (3 maples) → selectable, over-stock errors.
// p2: no price (anywhere) + stock 50 → disabled "— sin precio".
// p3: price + stock 0 → disabled "— sin stock".
const inventory: InventoryItem[] = [
  { _id: 'inv1', productId: 'p1', quantity: 3, lowStockThreshold: 20, lastUpdated: '2026-01-01T00:00:00Z' },
  { _id: 'inv2', productId: 'p2', quantity: 50, lowStockThreshold: 20, lastUpdated: '2026-01-01T00:00:00Z' },
  { _id: 'inv3', productId: 'p3', quantity: 0, lowStockThreshold: 20, lastUpdated: '2026-01-01T00:00:00Z' },
];

const priceFor = (productId: string, price: number): PriceEntry => ({
  _id: `price-${productId}`,
  productId,
  price,
  unit: 'maple',
  effectiveFrom: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
});

/** Add the first row and open its product dropdown. */
const openProductDropdown = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Agregar Producto/i }));
  const select = await screen.findByLabelText('Producto');
  fireEvent.mouseDown(select);
  return screen.findByRole('listbox');
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('NewOrderPage — empty order + stock gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = 'admin';
    // p1 and p3 have an active maple price; p2 has none anywhere.
    productsApiMock.getActivePrice.mockImplementation((id: string, unit?: string) => {
      if (unit !== 'maple') return Promise.reject(new Error('no cajon price'));
      if (id === 'p1') return Promise.resolve(priceFor('p1', 25));
      if (id === 'p3') return Promise.resolve(priceFor('p3', 30));
      return Promise.reject(new Error('no price'));
    });
  });

  it('starts EMPTY — no product rows, just the add-product prompt', async () => {
    renderWithProviders(<NewOrderPage />);

    expect(await screen.findByText('Agregá un producto al pedido')).toBeDefined();
    // No row rendered until the user adds one.
    expect(screen.queryByLabelText('Producto')).toBeNull();
    expect(screen.queryByRole('button', { name: /Quitar producto/i })).toBeNull();
  });

  it('gates selectable options by stock and price', async () => {
    renderWithProviders(<NewOrderPage />);
    await screen.findByText('Agregá un producto al pedido');

    const listbox = await openProductDropdown();

    // p1 has price + stock → selectable, shows the available stock.
    const p1Option = within(listbox).getByText(/Blanco Chico \(3 maples\)/i);
    expect(p1Option.getAttribute('aria-disabled')).not.toBe('true');

    // p3 has price but stock 0 → visible but disabled "— sin stock".
    const p3Option = within(listbox).getByText(/Blanco Surtido .* sin stock/i);
    expect(p3Option.getAttribute('aria-disabled')).toBe('true');

    // p2 has stock but no price → visible but disabled "— sin precio".
    const p2Option = within(listbox).getByText(/Castaño Chico .* sin precio/i);
    expect(p2Option.getAttribute('aria-disabled')).toBe('true');
  });

  it('marks the row in error when the quantity exceeds the available stock', async () => {
    renderWithProviders(<NewOrderPage />);
    await screen.findByText('Agregá un producto al pedido');

    await openProductDropdown();
    fireEvent.click(await screen.findByRole('option', { name: /Blanco Chico/i }));

    // Hint shows the available stock once a product is chosen.
    expect(await screen.findByText(/Disponible: 3 maples/i)).toBeDefined();

    // Stock is 3 → the 4th increment exceeds it.
    const increase = screen.getByRole('button', { name: /Aumentar cantidad/i });
    for (let i = 0; i < 4; i += 1) fireEvent.click(increase);

    expect(await screen.findByText(/Solo tenés 3 maples/i)).toBeDefined();
  });

  it('relaxes the stock gate when "Permitir preventa" is on (admin only)', async () => {
    renderWithProviders(<NewOrderPage />);
    await screen.findByText('Agregá un producto al pedido');

    const preSaleSwitch = screen.getByRole('switch', { name: /Permitir preventa/i });
    fireEvent.click(preSaleSwitch);
    expect(await screen.findByText(/Vendiendo sin stock/i)).toBeDefined();

    // The stock-0 product becomes selectable while preventa is active.
    await openProductDropdown();
    const p3Option = await screen.findByRole('option', { name: /Blanco Surtido/i });
    expect(p3Option.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('hides the preventa switch for non-admin users', async () => {
    authState.role = 'driver';
    renderWithProviders(<NewOrderPage />);
    await screen.findByText('Agregá un producto al pedido');

    expect(screen.queryByRole('switch', { name: /Permitir preventa/i })).toBeNull();
  });

  it('allows the same product in a second row with a different unit', async () => {
    productsApiMock.getActivePrice.mockImplementation((id: string, unit?: string) => {
      if (id === 'p1' && unit === 'maple') return Promise.resolve(priceFor('p1', 25));
      if (id === 'p1' && unit === 'cajon') {
        return Promise.resolve({ ...priceFor('p1', 250), unit: 'cajon' });
      }
      return Promise.reject(new Error('no price'));
    });

    renderWithProviders(<NewOrderPage />);
    await screen.findByText('Agregá un producto al pedido');

    // Row 1: Blanco Chico, 2 maples.
    await openProductDropdown();
    fireEvent.click(await screen.findByRole('option', { name: /Blanco Chico/i }));
    const increase = screen.getByRole('button', { name: /Aumentar cantidad/i });
    fireEvent.click(increase);
    fireEvent.click(increase);

    // Row 2: the SAME product must still be offered.
    fireEvent.click(await screen.findByRole('button', { name: /Agregar Otro Producto/i }));
    const selects = screen.getAllByLabelText('Producto');
    fireEvent.mouseDown(selects[1]!);
    const secondListbox = await screen.findByRole('listbox');
    const repeatOption = within(secondListbox).getByRole('option', { name: /Blanco Chico/i });
    expect(repeatOption.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(repeatOption);

    // Switch the second row to cajón — a different unit is a valid separate line.
    const cajonButtons = screen.getAllByRole('button', { name: /^Cajón$/ });
    fireEvent.click(cajonButtons[1]!);

    await waitFor(() => {
      expect(screen.queryByText(/Sin precio activo en cajones/i)).toBeNull();
    });
    expect(screen.getAllByText(/Blanco Chico/i).length).toBeGreaterThanOrEqual(2);
  });

  it('validates stock in aggregate when the same product repeats', async () => {
    renderWithProviders(<NewOrderPage />);
    await screen.findByText('Agregá un producto al pedido');

    // Row 1: 2 maples (stock is 3).
    await openProductDropdown();
    fireEvent.click(await screen.findByRole('option', { name: /Blanco Chico/i }));
    let increase = screen.getByRole('button', { name: /Aumentar cantidad/i });
    fireEvent.click(increase);
    fireEvent.click(increase);

    // Row 2: 2 more maples → 4 total, so only 1 is left for each row.
    fireEvent.click(await screen.findByRole('button', { name: /Agregar Otro Producto/i }));
    const selects = screen.getAllByLabelText('Producto');
    fireEvent.mouseDown(selects[1]!);
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: /Blanco Chico/i }));
    increase = screen.getAllByRole('button', { name: /Aumentar cantidad/i })[1]!;
    fireEvent.click(increase);
    fireEvent.click(increase);

    const errors = await screen.findAllByText(/Solo tenés 1 maples/i);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('offers the Stock page link in the empty state when nothing has a price', async () => {
    productsApiMock.getActivePrice.mockImplementation(() => Promise.reject(new Error('no price')));
    renderWithProviders(<NewOrderPage />);

    expect(await screen.findByText('Agregá un producto al pedido')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Cargar precios en Productos/i }));
    expect(navigateMock).toHaveBeenCalledWith('/products');
  });
});
