import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDatabase, stopTestDatabase, clearDatabase } from './helpers.js';
import { seedDatabase } from '../seed.js';
import { Customer } from '../modules/customers/model.js';
import { User } from '../modules/auth/model.js';
import { Product } from '../modules/products/model.js';
import { Inventory } from '../modules/inventory/model.js';

describe('Seed idempotency', () => {
  beforeAll(async () => { await startTestDatabase(); });
  afterAll(async () => { await stopTestDatabase(); });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('creates the walk-in customer + puesto user exactly once across two runs', async () => {
    await seedDatabase();
    await seedDatabase();

    const walkIn = await Customer.find({ name: 'Puesto (mostrador)' });
    expect(walkIn).toHaveLength(1);
    expect(walkIn[0]!.type).toBe('B2C');
    expect(walkIn[0]!.creditConfig).toMatchObject({ limit: 0, termDays: 0 });
    expect(walkIn[0]!.address).toBe('Mostrador del puesto');

    const puestoUsers = await User.find({ email: 'puesto@leaderegg.com' });
    expect(puestoUsers).toHaveLength(1);
    expect(puestoUsers[0]!.name).toBe('Empleado Puesto');
    expect(puestoUsers[0]!.role).toBe('puesto');

    // Sanity: existing seed entities also stay single (products, superadmin).
    expect(await User.find({ email: 'admin@leaderegg.com' })).toHaveLength(1);
    expect(await User.find({ role: 'superadmin' })).toHaveLength(1);
  });

  it('seeds exactly 10 products (2 varieties × 5 calibers) with zero-quantity inventory', async () => {
    await seedDatabase();

    const products = await Product.find();
    expect(products).toHaveLength(10);

    const combos = new Set(products.map((p) => `${p.variety}-${p.caliber}`));
    expect(combos.size).toBe(10);
    for (const p of products) {
      expect(p.eggsPerMaple).toBe(30);
      expect(p.maplesPerCajon).toBe(12);
      expect(p.lowStockThreshold).toBe(20);
    }

    const inventory = await Inventory.find();
    expect(inventory).toHaveLength(10);
    expect(inventory.every((inv) => inv.quantity === 0)).toBe(true);

    // Re-running the seed is idempotent (still 10 products, no duplicates).
    await seedDatabase();
    expect(await Product.countDocuments()).toBe(10);
  });

  it('promotes a legacy admin to superadmin on re-seed (existing behavior)', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('admin123', 10);
    await User.create({
      name: 'Admin',
      email: 'admin@leaderegg.com',
      passwordHash,
      role: 'admin'
    });

    await seedDatabase();

    const admin = await User.findOne({ email: 'admin@leaderegg.com' });
    expect(admin!.role).toBe('superadmin');
  });
});