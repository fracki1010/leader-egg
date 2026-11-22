import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { StockPage } from '../StockPage.tsx';
import type { InventoryItem, PriceEntry, Product } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { inventoryApiMock, productsApiMock, navigateMock } = vi.hoisted(() => ({
  inventoryApiMock: { getAll: vi.fn(), classify: vi.fn() },
  productsApiMock: { list: vi.fn(), getActivePrice: vi.fn(), getOptions: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('../../api/inventory.ts', () => ({ inventoryApi: inventoryApiMock }));
vi.mock('../../api/products.ts', () => ({ productsApi: productsApiMock }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
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

const inventory = (id: string, productId: string, quantity: number): InventoryItem => ({
  _id: id,
  productId: { _id: productId, variety: 'blanco', caliber: 'surtido', lowStockThreshold: 20 },
  quantity,
  lowStockThreshold: 20,
  lastUpdated: '2026-01-01T00:00:00Z',
});

const price: PriceEntry = {
  _id: 'price1',
  productId: 'p1',
  price: 25,
  unit: 'maple',
  effectiveFrom: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
};

const products: Product[] = [
  product('p1', 'blanco', 'surtido', 'Blanco Surtido'),
  product('p2', 'blanco', 'chico', 'Blanco Chico'),
  product('p3', 'castaño', 'chico', 'Castaño Chico'),
];

const inventoryList: InventoryItem[] = [
  inventory('inv1', 'p1', 10),
  inventory('inv2', 'p2', 0),
  inventory('inv3', 'p3', 0),
];

const options = {
  varieties: [
    { value: 'blanco', label: 'Blanco' },
    { value: 'castaño', label: 'Castaño' },
  ],
  calibers: [
    { value: 'chico', label: 'Chico' },
    { value: 'mediano', label: 'Mediano' },
    { value: 'grande', label: 'Grande' },
    { value: 'extragrande', label: 'Extra Grande' },
    { value: 'surtido', label: 'Surtido' },
  ],
  combos: [],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('StockPage — Clasificar dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inventoryApiMock.getAll.mockResolvedValue(inventoryList);
    inventoryApiMock.classify.mockResolvedValue({
      source: inventoryList[0],
      targets: [inventoryList[1], inventoryList[2]],
      referenceId: 'classify-123e4567-e89b-12d3-a456-426614174000',
    });
    productsApiMock.list.mockResolvedValue(products);
    productsApiMock.getActivePrice.mockResolvedValue(price);
    productsApiMock.getOptions.mockResolvedValue(options);
  });

  const openClassifyDialog = async () => {
    renderWithProviders(<StockPage />);
    // Only cards with stock show the action — Surtido (10) is the only one.
    fireEvent.click(await screen.findByRole('button', { name: /Clasificar/ }));
    return await screen.findByRole('dialog');
  };

  it('groups products by variety and only shows the Clasificar action on cards with stock', async () => {
    renderWithProviders(<StockPage />);
    await screen.findByText('Sin clasificar');

    // Variety section headers
    expect(await screen.findByRole('heading', { level: 6, name: 'Blanco' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 6, name: 'Castaño' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: /Clasificar/ })).toHaveLength(1);
  });

  it('blocks a classify that exceeds the available stock (live Σ validation)', async () => {
    const dialog = await openClassifyDialog();

    expect(within(dialog).getByText('10 maples')).toBeDefined();
    expect(within(dialog).getByText('0 de 10 maples')).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText('Cantidad 1'), { target: { value: '12' } });

    expect(within(dialog).getByText('12 de 10 maples')).toBeDefined();
    expect(within(dialog).getByText('La suma supera el stock disponible del producto origen.')).toBeDefined();

    const save = within(dialog).getByRole('button', { name: 'Clasificar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(inventoryApiMock.classify).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('classifies successfully and refreshes the list', async () => {
    const dialog = await openClassifyDialog();

    // Row 1: Blanco Chico × 4
    fireEvent.change(within(dialog).getByLabelText('Cantidad 1'), { target: { value: '4' } });
    fireEvent.mouseDown(within(dialog).getByLabelText('Producto 1'));
    fireEvent.click(await screen.findByRole('option', { name: 'Blanco Chico' }));

    // Row 2: Castaño Chico × 6
    fireEvent.click(within(dialog).getByRole('button', { name: /Agregar producto/ }));
    fireEvent.change(within(dialog).getByLabelText('Cantidad 2'), { target: { value: '6' } });
    fireEvent.mouseDown(within(dialog).getByLabelText('Producto 2'));
    fireEvent.click(await screen.findByRole('option', { name: 'Castaño Chico' }));

    fireEvent.change(within(dialog).getByLabelText(/Notas/), { target: { value: 'Clasificación quincenal' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clasificar' }));

    await waitFor(() => {
      expect(inventoryApiMock.classify).toHaveBeenCalledWith('p1', {
        to: [
          { productId: 'p2', quantity: 4 },
          { productId: 'p3', quantity: 6 },
        ],
        notes: 'Clasificación quincenal',
      });
    });

    expect(await screen.findByText('Surtido clasificado')).toBeDefined();
    expect(inventoryApiMock.getAll).toHaveBeenCalledTimes(2); // initial + refresh
  });
});
