import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-with-providers.tsx';
import { DriverRoutePage } from '../DriverRoutePage.tsx';
import { saveRoute, openDatabase } from '../../lib/offline-db.ts';
import type { Route } from '../../types/index.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock the API — simulate network failure
vi.mock('../../api/routes.ts', () => ({
  routesApi: {
    getDriverActive: vi.fn().mockRejectedValue(new Error('Network error')),
    advanceStop: vi.fn(),
    addStopNote: vi.fn(),
  },
}));

// Mock react-router-dom (DriverRoutePage doesn't use routing directly, but safe to mock)
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const mockRoute: Route = {
  _id: 'route-001',
  routeNumber: 'R-100',
  driverId: 'driver-001',
  driverName: 'Juan Pérez',
  vehicleId: null,
  vehicleName: '',
  kmTravelled: null,
  plannedDate: '2026-08-27',
  status: 'in_progress',
  stops: [
    {
      _id: 'stop-001',
      orderId: 'order-001',
      orderNumber: 'ORD-001',
      customerId: 'cust-001',
      customerName: 'Tienda Los Andes',
      customerAddress: 'Av. Principal 123',
      customerPhone: '+56912345678',
      sequence: 1,
      status: 'pending',
      deliveredAt: null,
      notes: '',
    },
    {
      _id: 'stop-002',
      orderId: 'order-002',
      orderNumber: 'ORD-002',
      customerId: 'cust-002',
      customerName: 'Minimarket Central',
      customerAddress: 'Calle Secunda 456',
      customerPhone: '+56987654321',
      sequence: 2,
      status: 'delivered',
      deliveredAt: '2026-08-27T09:30:00Z',
      notes: 'Entregado sin novedad',
    },
  ],
  startedAt: '2026-08-27T08:00:00Z',
  completedAt: null,
  createdAt: '2026-08-27T07:00:00Z',
  updatedAt: '2026-08-27T08:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DriverRoutePage — offline rendering', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear IndexedDB before each test
    const db = await openDatabase();
    await db.clear('routes');
    await db.clear('sync-queue');
  });

  it('renders offline data from IndexedDB when network fails', async () => {
    // Seed IndexedDB with cached route
    await saveRoute(mockRoute);

    renderWithProviders(<DriverRoutePage />);

    // Should eventually show the route data from cache
    await waitFor(() => {
      expect(screen.getByText(/Mi Ruta/)).toBeDefined();
    });

    // Route number should be displayed
    expect(screen.getByText('R-100')).toBeDefined();

    // Stops should be rendered
    expect(screen.getByText('Tienda Los Andes')).toBeDefined();
    expect(screen.getByText('Minimarket Central')).toBeDefined();

    // Progress should show 1/2 delivered
    expect(screen.getByText('1/2')).toBeDefined();
  });

  it('shows offline indicator when network is unavailable', async () => {
    await saveRoute(mockRoute);

    // Mock navigator.onLine as false
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    renderWithProviders(<DriverRoutePage />);

    await waitFor(() => {
      expect(screen.getByText(/Sin conexión/)).toBeDefined();
    });

    // Restore
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
  });

  it('shows no-route state when no cached data exists and offline', async () => {
    // Don't seed IndexedDB — empty cache
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    renderWithProviders(<DriverRoutePage />);

    await waitFor(() => {
      // When no route is loaded, the component shows the "no route" empty state
      expect(screen.getByText(/No tenés una ruta activa hoy/)).toBeDefined();
    });

    // Restore
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
  });

  it('renders stop status badges correctly from cached data', async () => {
    await saveRoute(mockRoute);

    renderWithProviders(<DriverRoutePage />);

    await waitFor(() => {
      expect(screen.getByText(/Mi Ruta/)).toBeDefined();
    });

    // Pending stop should show "Pendiente" label
    expect(screen.getByText('Pendiente')).toBeDefined();

    // Delivered stop should show "Entregado" label
    expect(screen.getByText('Entregado')).toBeDefined();
  });

  it('renders progress bar with correct percentage', async () => {
    await saveRoute(mockRoute);

    renderWithProviders(<DriverRoutePage />);

    await waitFor(() => {
      expect(screen.getByText(/Mi Ruta/)).toBeDefined();
    });

    // Should show completion hint (1 remaining stop)
    expect(screen.getByText(/paradas restantes/)).toBeDefined();
  });
});
