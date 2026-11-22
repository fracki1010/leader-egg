import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDatabase,
  saveRoute,
  getRoute,
  clearRoutes,
  addSyncItem,
  getPendingItems,
  markSynced,
  markConflict,
} from '../offline-db.ts';
import type { Route } from '../../types/index.ts';

// ─── Test fixtures ──────────────────────────────────────────────────────────

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
  ],
  startedAt: '2026-08-27T08:00:00Z',
  completedAt: null,
  createdAt: '2026-08-27T07:00:00Z',
  updatedAt: '2026-08-27T08:00:00Z',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('offline-db', () => {
  beforeEach(async () => {
    const db = await openDatabase();
    await db.clear('routes');
    await db.clear('sync-queue');
  });

  describe('routes CRUD', () => {
    it('saves and retrieves a route', async () => {
      await saveRoute(mockRoute);
      const cached = await getRoute('route-001');

      expect(cached).toBeDefined();
      expect(cached!.routeId).toBe('route-001');
      expect(cached!.data._id).toBe('route-001');
      expect(cached!.data.routeNumber).toBe('R-100');
      expect(cached!.fetchedAt).toBeGreaterThan(0);
    });

    it('returns undefined for non-existent route', async () => {
      const cached = await getRoute('non-existent');
      expect(cached).toBeUndefined();
    });

    it('overwrites route on update', async () => {
      await saveRoute(mockRoute);

      const updated: Route = { ...mockRoute, status: 'completed' };
      await saveRoute(updated);

      const cached = await getRoute('route-001');
      expect(cached!.data.status).toBe('completed');
    });

    it('clears all routes', async () => {
      await saveRoute(mockRoute);
      await saveRoute({ ...mockRoute, _id: 'route-002', routeNumber: 'R-101' });

      await clearRoutes();

      const cached = await getRoute('route-001');
      expect(cached).toBeUndefined();
    });
  });

  describe('sync-queue CRUD', () => {
    it('adds a sync item and retrieves it', async () => {
      const id = await addSyncItem({
        operation: 'advanceStop',
        payload: {
          routeId: 'route-001',
          stopId: 'stop-001',
          status: 'delivered',
        },
        timestamp: Date.now(),
      });

      expect(id).toBeDefined();

      const pending = await getPendingItems();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.id).toBe(id);
      expect(pending[0]!.synced).toBe(false);
      expect(pending[0]!.conflict).toBe(false);
    });

    it('marks item as synced', async () => {
      const id = await addSyncItem({
        operation: 'advanceStop',
        payload: { routeId: 'route-001', stopId: 'stop-001', status: 'delivered' },
        timestamp: Date.now(),
      });

      await markSynced(id);

      const pending = await getPendingItems();
      expect(pending).toHaveLength(0);
    });

    it('marks item as conflict', async () => {
      const id = await addSyncItem({
        operation: 'advanceStop',
        payload: { routeId: 'route-001', stopId: 'stop-001', status: 'delivered' },
        timestamp: Date.now(),
      });

      await markConflict(id, 'Server state updated by dispatch');

      const pending = await getPendingItems();
      expect(pending).toHaveLength(1); // conflict items are still pending (unsynced)
      expect(pending[0]!.conflict).toBe(true);
    });

    it('returns only unsynced items', async () => {
      const id1 = await addSyncItem({
        operation: 'advanceStop',
        payload: { routeId: 'route-001', stopId: 'stop-001', status: 'delivered' },
        timestamp: Date.now(),
      });
      await addSyncItem({
        operation: 'addNote',
        payload: { routeId: 'route-001', stopId: 'stop-002', notes: 'Left at door' },
        timestamp: Date.now(),
      });

      await markSynced(id1);

      const pending = await getPendingItems();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.operation).toBe('addNote');
    });

    it('preserves multiple pending items with timestamps', async () => {
      const ts1 = Date.now();
      const ts2 = ts1 + 1000;

      await addSyncItem({
        operation: 'advanceStop',
        payload: { routeId: 'r1', stopId: 's1', status: 'delivered' },
        timestamp: ts1,
      });
      await addSyncItem({
        operation: 'addNote',
        payload: { routeId: 'r1', stopId: 's2', notes: 'Note' },
        timestamp: ts2,
      });

      const pending = await getPendingItems();
      expect(pending).toHaveLength(2);
      // Verify both items exist with correct timestamps (order not guaranteed by IndexedDB)
      const timestamps = pending.map((item) => item.timestamp).sort();
      expect(timestamps).toEqual([ts1, ts2]);
    });
  });
});
