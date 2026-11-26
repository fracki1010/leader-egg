import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startTestDatabase, stopTestDatabase } from './helpers.js';
import { Tenant, WhatsappInstance } from '../tenancy/master-models.js';
import { deprovisionTenant } from '../tenancy/tenants.js';
import { getEvolutionClient } from '../modules/whatsapp/evolution-client.js';
import { AppError } from '../middleware/error-handler.js';

vi.mock('../modules/whatsapp/evolution-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/whatsapp/evolution-client.js')>()),
  getEvolutionClient: vi.fn()
}));

const evolution = { deleteInstance: vi.fn(async () => ({})) };

describe('deprovisionTenant and its WhatsApp line', () => {
  let tenantId: string;
  let slug: string;
  let instanceName: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getEvolutionClient).mockReturnValue(evolution as unknown as ReturnType<typeof getEvolutionClient>);
    // Each test deletes its own throwaway tenant, so the order of tests does not matter.
    slug = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await Tenant.create({ name: 'Negocio de prueba', slug, dbName: `tenant_${slug}`, active: true });
    tenantId = String(tenant._id);
    instanceName = `tenant-${slug}`;
    await WhatsappInstance.create({ tenantId: tenant._id, instanceName, providerCreated: true });
  });

  const deprovision = () => deprovisionTenant(tenantId, { confirm: slug, allowPrimary: true });

  it('deletes the line in Evolution and its record together with the tenant', async () => {
    await deprovision();

    expect(evolution.deleteInstance).toHaveBeenCalledWith(instanceName);
    expect(await WhatsappInstance.countDocuments({ tenantId })).toBe(0);
    expect(await Tenant.findById(tenantId)).toBeNull();
  });

  it('keeps the tenant and its line when Evolution cannot delete the line', async () => {
    evolution.deleteInstance.mockRejectedValueOnce(new AppError('No se puede vincular WhatsApp ahora. Probá de nuevo en unos minutos.', 503));

    await expect(deprovision()).rejects.toMatchObject({ status: 503 });

    expect(await WhatsappInstance.countDocuments({ tenantId })).toBe(1);
    expect(await Tenant.findById(tenantId)).not.toBeNull();
  });

  it('treats a line Evolution never created as already gone', async () => {
    evolution.deleteInstance.mockRejectedValueOnce(new AppError('WhatsApp instance not found', 404));

    await deprovision();

    expect(await WhatsappInstance.countDocuments({ tenantId })).toBe(0);
    expect(await Tenant.findById(tenantId)).toBeNull();
  });
});
