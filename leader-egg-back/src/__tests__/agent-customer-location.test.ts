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
  cancelAction,
  confirmAction,
  prepareCustomerLocationAction
} from '../modules/agent/actions.js';
import { runInWhatsappChat } from '../modules/agent/channel-context.js';

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

  it('records the WhatsApp chat that prepared the action, and null outside WhatsApp', async () => {
    await inTenant(() => Customer.create({ name: 'Rosa Vidal', type: 'B2C', phone: '3', address: 'E' }));

    await inTenant(() =>
      runInWhatsappChat('5491155550077@s.whatsapp.net', () =>
        prepareCustomerLocationAction({ customerName: 'Rosa Vidal', lat: -34.6, lng: -58.4 }, ctx)
      )
    );
    await inTenant(() => prepareCustomerLocationAction({ customerName: 'Rosa Vidal', lat: -34.6, lng: -58.4 }, ctx));

    const actions = await inTenant(() =>
      AgentPendingAction.find({ type: 'set_customer_location' }).sort({ createdAt: 1 })
    );
    expect(actions.map((a) => a.channelChatId)).toEqual(['5491155550077@s.whatsapp.net', null]);
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

  it('refuses a stored payload that no longer has the expected shape, and writes nothing', async () => {
    const customer = await inTenant(() => Customer.create({ name: 'Elena Soto', type: 'B2C', phone: '4', address: 'F' }));
    const action = await inTenant(() =>
      AgentPendingAction.create({
        userId: USER_ID,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'set_customer_location',
        payload: { customerId: 'no-es-un-id', location: { type: 'Point', coordinates: [0, 0] } },
        preview: 'Ubicación de Elena Soto',
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      })
    );

    await expect(
      inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], String(action._id)))
    ).rejects.toMatchObject({ status: 400 });

    expect((await inTenant(() => Customer.findById(customer._id)))?.location).toBeUndefined();
  });

  it('refuses a stored location outside the coordinate range, with a valid customer id', async () => {
    const customer = await inTenant(() => Customer.create({ name: 'Iván Peña', type: 'B2C', phone: '5', address: 'G' }));
    const action = await inTenant(() =>
      AgentPendingAction.create({
        userId: USER_ID,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'set_customer_location',
        payload: { customerId: String(customer._id), location: { type: 'Point', coordinates: [999, 999] } },
        preview: 'Ubicación de Iván Peña',
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      })
    );

    await expect(
      inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], String(action._id)))
    ).rejects.toMatchObject({ status: 400 });

    expect((await inTenant(() => Customer.findById(customer._id)))?.location).toBeUndefined();
  });

  it.each([
    ['a Polygon instead of a Point', (id: string) => ({ customerId: id, location: { type: 'Polygon', coordinates: [0, 0] } })],
    ['three coordinates', (id: string) => ({ customerId: id, location: { type: 'Point', coordinates: [1, 2, 3] } })],
    ['one coordinate', (id: string) => ({ customerId: id, location: { type: 'Point', coordinates: [1] } })],
    ['longitude below -180', (id: string) => ({ customerId: id, location: { type: 'Point', coordinates: [-181, 0] } })],
    ['latitude above 90', (id: string) => ({ customerId: id, location: { type: 'Point', coordinates: [0, 91] } })],
    ['an uppercase customer id', (id: string) => ({ customerId: `A${id.slice(1)}`, location: { type: 'Point', coordinates: [0, 0] } })],
    ['longitude above 180', (id: string) => ({ customerId: id, location: { type: 'Point', coordinates: [181, 0] } })],
    ['latitude below -90', (id: string) => ({ customerId: id, location: { type: 'Point', coordinates: [0, -91] } })],
    ['a 25-character id', (id: string) => ({ customerId: `${id}0`, location: { type: 'Point', coordinates: [0, 0] } })],
    ['a 23-character id', (id: string) => ({ customerId: id.slice(1), location: { type: 'Point', coordinates: [0, 0] } })],
    ['a prefixed id', (id: string) => ({ customerId: `x${id}`, location: { type: 'Point', coordinates: [0, 0] } })],
    ['a non-hex id', () => ({ customerId: 'g'.repeat(24), location: { type: 'Point', coordinates: [0, 0] } })]
  ])('refuses a stored location with %s, and writes nothing', async (_label, build) => {
    const customer = await inTenant(() => Customer.create({ name: 'Cliente Prueba', type: 'B2C', phone: '6', address: 'H' }));
    const action = await inTenant(() =>
      AgentPendingAction.create({
        userId: USER_ID,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'set_customer_location',
        payload: build(String(customer._id)),
        preview: 'Ubicación de prueba',
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      })
    );

    await expect(
      inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], String(action._id)))
    ).rejects.toMatchObject({ status: 400 });

    expect((await inTenant(() => Customer.findById(customer._id)))?.location).toBeUndefined();
  });

  it.each([
    [180, 90],
    [-180, -90]
  ])('accepts the edge coordinates [%i, %i] and writes them', async (lng, lat) => {
    const customer = await inTenant(() => Customer.create({ name: 'Borde Límite', type: 'B2C', phone: '8', address: 'I' }));
    const action = await inTenant(() =>
      AgentPendingAction.create({
        userId: USER_ID,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'set_customer_location',
        payload: { customerId: String(customer._id), location: { type: 'Point', coordinates: [lng, lat] } },
        preview: 'Ubicación en el borde',
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      })
    );

    await inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], String(action._id)));

    expect((await inTenant(() => Customer.findById(customer._id)))?.location?.coordinates).toEqual([lng, lat]);
  });

  it('confirms and cancels only from the chat that prepared the action', async () => {
    const LINKED = '5491155550011@s.whatsapp.net';
    const OTHER = '5491155550022@s.whatsapp.net';
    const customer = await inTenant(() => Customer.create({ name: 'Sara Mora', type: 'B2C', phone: '9', address: 'J' }));
    await inTenant(() =>
      runInWhatsappChat(LINKED, () =>
        prepareCustomerLocationAction({ customerName: 'Sara Mora', lat: -31.4, lng: -64.2 }, ctx)
      )
    );
    const id = String((await inTenant(() => AgentPendingAction.findOne({ type: 'set_customer_location' })))!._id);

    await expect(
      inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], id))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(() => runInWhatsappChat(OTHER, () => confirmAction(String(USER_ID), 'admin', ['customers.manage'], id)))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(() => runInWhatsappChat(OTHER, () => cancelAction(String(USER_ID), id)))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(() => cancelAction(String(USER_ID), id))
    ).rejects.toMatchObject({ status: 404 });
    expect((await inTenant(() => Customer.findById(customer._id)))?.location).toBeUndefined();

    await inTenant(() =>
      runInWhatsappChat(LINKED, () => confirmAction(String(USER_ID), 'admin', ['customers.manage'], id))
    );
    expect((await inTenant(() => Customer.findById(customer._id)))?.location?.coordinates).toEqual([-64.2, -31.4]);
  });

  it('lets no WhatsApp chat confirm or cancel an action made in the app', async () => {
    const OTHER = '5491155550022@s.whatsapp.net';
    const customer = await inTenant(() => Customer.create({ name: 'Tomás Vera', type: 'B2C', phone: '7', address: 'K' }));
    await inTenant(() => prepareCustomerLocationAction({ customerName: 'Tomás Vera', lat: -31.4, lng: -64.2 }, ctx));
    const id = String((await inTenant(() => AgentPendingAction.findOne({ type: 'set_customer_location' })))!._id);

    await expect(
      inTenant(() => runInWhatsappChat(OTHER, () => confirmAction(String(USER_ID), 'admin', ['customers.manage'], id)))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inTenant(() => runInWhatsappChat(OTHER, () => cancelAction(String(USER_ID), id)))
    ).rejects.toMatchObject({ status: 404 });

    await inTenant(() => confirmAction(String(USER_ID), 'admin', ['customers.manage'], id));
    expect((await inTenant(() => Customer.findById(customer._id)))?.location?.coordinates).toEqual([-64.2, -31.4]);
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
