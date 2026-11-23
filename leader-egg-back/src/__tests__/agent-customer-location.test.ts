import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase, getTestTenantId } from './helpers.js';
import { Tenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { AppError } from '../middleware/error-handler.js';
import { Customer } from '../modules/customers/model.js';
import { AgentPendingAction } from '../modules/agent/model.js';
import {
  confirmAction,
  prepareCustomerLocationAction
} from '../modules/agent/actions.js';

const USER_ID = new Types.ObjectId();
const ctx = {
  userId: USER_ID,
  conversationId: new Types.ObjectId(),
  messageId: new Types.ObjectId()
} as unknown as Parameters<typeof prepareCustomerLocationAction>[1];

describe('agent: set_customer_location', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  /** Runs `fn` inside the test tenant's connection, as the agent does. */
  const inTenant = async <T>(fn: () => Promise<T>): Promise<T> => {
    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    return runWithTenancy({ connection, tenantId: String(tenant!._id) }, fn);
  };

  it('prepares the location update for one customer, without writing it', async () => {
    const customer = await inTenant(() => Customer.create({ name: 'Juan Pérez', type: 'B2C', phone: '1', address: 'Calle 1' }));

    await inTenant(() =>
      prepareCustomerLocationAction({ customerName: 'juan pérez', lat: -34.6, lng: -58.4 }, ctx)
    );

    const pending = await inTenant(() => AgentPendingAction.findOne({ type: 'set_customer_location' }));
    expect(pending?.payload).toMatchObject({
      customerId: String(customer._id),
      location: { type: 'Point', coordinates: [-58.4, -34.6] }
    });
    const stored = await inTenant(() => Customer.findById(customer._id));
    expect(stored?.location).toBeUndefined();
  });

  it('refuses a customer name that does not exist', async () => {
    await expect(
      inTenant(() => prepareCustomerLocationAction({ customerName: 'Nadie', lat: 0, lng: 0 }, ctx))
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses when more than one customer has that name', async () => {
    await inTenant(async () => {
      await Customer.create({ name: 'Ana López', type: 'B2C', phone: '1', address: 'A' });
      await Customer.create({ name: 'Ana López', type: 'B2C', phone: '2', address: 'B' });
    });

    await expect(
      inTenant(() => prepareCustomerLocationAction({ customerName: 'Ana López', lat: 0, lng: 0 }, ctx))
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses without customers.manage and writes nothing; a refused action is finished', async () => {
    const customer = await inTenant(() => Customer.create({ name: 'Luis Gómez', type: 'B2C', phone: '1', address: 'C' }));
    await inTenant(() => prepareCustomerLocationAction({ customerName: 'Luis Gómez', lat: -31.4, lng: -64.2 }, ctx));
    const action = await inTenant(() => AgentPendingAction.findOne({ type: 'set_customer_location' }));

    await expect(
      inTenant(() => confirmAction(String(USER_ID), 'admin', ['orders.manage'], String(action!._id)))
    ).rejects.toMatchObject({ status: 403 });

    expect((await inTenant(() => Customer.findById(customer._id)))?.location).toBeUndefined();
    const refused = await inTenant(() => AgentPendingAction.findById(action!._id));
    expect(refused?.status).toBe('failed');
  });

  it('writes the location when a permitted user confirms', async () => {
    const customer = await inTenant(() => Customer.create({ name: 'Marta Ruiz', type: 'B2C', phone: '2', address: 'D' }));
    await inTenant(() => prepareCustomerLocationAction({ customerName: 'Marta Ruiz', lat: -31.4, lng: -64.2 }, ctx));
    const action = await inTenant(() => AgentPendingAction.findOne({ type: 'set_customer_location' }));

    await inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], String(action!._id)));

    const stored = await inTenant(() => Customer.findById(customer._id));
    expect(stored?.location?.coordinates).toEqual([-64.2, -31.4]);
  });
});
