import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import {
  startTestDatabase,
  stopTestDatabase,
  clearDatabase,
  seedAdminUser,
  seedDriverUser,
  seedPuestoUser,
  seedProducts,
  getProductIds,
  createTestCustomer,
  indexTestUser,
  loginAs
} from './helpers.js';
import { app } from '../app.js';
import { User } from '../modules/auth/model.js';
import { DEFAULT_PERMISSIONS_BY_ROLE } from '../modules/auth/permissions.js';
import { AgentMessage, AgentPendingAction, AgentToolCall, type IAgentPendingAction } from '../modules/agent/model.js';
import { Order } from '../modules/orders/model.js';
import { Payment } from '../modules/payments/model.js';
import { Customer } from '../modules/customers/model.js';
import { createOrder } from '../modules/orders/service.js';
import { Inventory } from '../modules/inventory/model.js';
import { prepareOrderStatusAction } from '../modules/agent/actions.js';
import type { ProviderAssistantMessage, ProviderMessage, ProviderToolCall } from '../modules/agent/provider.js';

/**
 * The provider module is the ONLY network boundary, so it is mocked for the
 * whole suite. Everything below (HTTP, tenancy, persistence, audit, permission
 * checks) runs against the real app + in-memory MongoDB.
 */
const providerMock = vi.hoisted(() => ({
  isAgentEnabled: vi.fn(),
  callProvider: vi.fn()
}));

vi.mock('../modules/agent/provider.js', () => ({
  isAgentEnabled: providerMock.isAgentEnabled,
  callProvider: providerMock.callProvider
}));

const request = supertest(app);

const bearer = (token: string): string => `Bearer ${token}`;

const assistant = (
  content: string | null,
  toolCalls?: ProviderToolCall[]
): ProviderAssistantMessage => ({ role: 'assistant', content, tool_calls: toolCalls });

const toolCall = (id: string, name: string, args: unknown): ProviderToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
});

describe('AI assistant (read-only)', () => {
  let adminToken: string;
  let driverToken: string;
  let puestoToken: string;
  let adminEmail: string;
  let adminPassword: string;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    await seedProducts();

    providerMock.isAgentEnabled.mockReset();
    providerMock.isAgentEnabled.mockReturnValue(true);
    providerMock.callProvider.mockReset();

    const admin = await seedAdminUser();
    adminEmail = admin.email;
    adminPassword = admin.password;
    const driver = await seedDriverUser();
    const puesto = await seedPuestoUser();

    adminToken = await loginAs(request, admin.email, admin.password);
    driverToken = await loginAs(request, driver.email, driver.password);
    puestoToken = await loginAs(request, puesto.email, puesto.password);
  });

  describe('feature flag', () => {
    it('returns enabled:false and POST 503 when AGENT_API_KEY is unset', async () => {
      providerMock.isAgentEnabled.mockReturnValue(false);

      const state = await request
        .get('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken));

      expect(state.status).toBe(200);
      expect(state.body.enabled).toBe(false);
      expect(state.body.messages).toEqual([]);

      const post = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: '¿Cómo está la caja?' });

      expect(post.status).toBe(503);
      expect(post.body.error).toContain('no está configurado');
      expect(providerMock.callProvider).not.toHaveBeenCalled();
    });
  });

  describe('role guard (admin only)', () => {
    it('returns 403 for driver', async () => {
      const get = await request
        .get('/api/v1/agent/chat')
        .set('Authorization', bearer(driverToken));
      expect(get.status).toBe(403);

      const post = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(driverToken))
        .send({ message: 'hola' });
      expect(post.status).toBe(403);
    });

    it('returns 403 for puesto', async () => {
      const res = await request
        .get('/api/v1/agent/chat')
        .set('Authorization', bearer(puestoToken));
      expect(res.status).toBe(403);
    });
  });

  describe('tool-calling loop', () => {
    it('executes a permitted tool, persists the reply and writes the audit row', async () => {
      providerMock.callProvider
        .mockResolvedValueOnce(assistant(null, [toolCall('call_1', 'get_company_accounts', {})]))
        .mockResolvedValueOnce(assistant('Tenés $0 en efectivo, $0 en Mercado Pago y $0 en banco.'));

      const res = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: '¿Cuánto hay en caja?' });

      expect(res.status).toBe(200);
      expect(res.body.reply).toContain('efectivo');
      expect(res.body.toolCalls).toHaveLength(1);
      expect(res.body.toolCalls[0]).toMatchObject({ name: 'get_company_accounts', ok: true });

      // The second provider round received a `tool` message with the result.
      const secondRoundMessages = providerMock.callProvider.mock.calls[1]?.[0] as ProviderMessage[];
      const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
      expect(toolMessage).toBeDefined();
      expect(toolMessage?.content).toContain('efectivo');

      const audit = await AgentToolCall.find({ tool: 'get_company_accounts' });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.ok).toBe(true);
      expect(audit[0]!.messageId).toBeDefined();

      const persisted = await AgentMessage.find({ role: 'assistant' });
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.content).toContain('efectivo');
      expect(persisted[0]!.toolCalls?.[0]?.name).toBe('get_company_accounts');
      expect(String(audit[0]!.messageId)).toBe(String(persisted[0]!._id));

      const state = await request
        .get('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken));
      expect(state.status).toBe(200);
      expect(state.body.enabled).toBe(true);
      expect(state.body.rateLimitPerHour).toBe(40);
      expect(state.body.messages).toHaveLength(2);
      expect(state.body.messages[0].role).toBe('user');
      expect(state.body.messages[1].role).toBe('assistant');
    });
  });

  describe('permission enforcement', () => {
    it('returns a permission error to the model and audits ok:false without leaking the permission', async () => {
      await User.updateOne(
        { email: adminEmail },
        { $set: { permissions: ['reports.view', 'orders.view', 'customers.view', 'accounts.view'] } }
      );
      const restrictedToken = await loginAs(request, adminEmail, adminPassword);

      providerMock.callProvider
        .mockResolvedValueOnce(assistant(null, [toolCall('call_stock', 'list_stock', {})]))
        .mockResolvedValueOnce(assistant('No tenés permiso para ver el stock.'));

      const res = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(restrictedToken))
        .send({ message: '¿Qué stock hay?' });

      expect(res.status).toBe(200);
      const secondRoundMessages = providerMock.callProvider.mock.calls[1]?.[0] as ProviderMessage[];
      const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toContain('Sin permiso para consultar el stock');
      expect(toolMessage?.content).not.toContain('stock.view');

      const audit = await AgentToolCall.findOne({ tool: 'list_stock' });
      expect(audit).not.toBeNull();
      expect(audit!.ok).toBe(false);
      expect(audit!.error).toContain('Sin permiso');
    });
  });

  describe('argument validation', () => {
    it('returns an invalid-args error instead of crashing', async () => {
      providerMock.callProvider
        .mockResolvedValueOnce(assistant(null, [toolCall('call_bad', 'get_order', {})]))
        .mockResolvedValueOnce(assistant('Necesito el número de la orden.'));

      const res = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: 'Mostrame una orden' });

      expect(res.status).toBe(200);
      expect(res.body.toolCalls[0]).toMatchObject({ name: 'get_order', ok: false });

      const secondRoundMessages = providerMock.callProvider.mock.calls[1]?.[0] as ProviderMessage[];
      const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toContain('Parámetros inválidos');

      const audit = await AgentToolCall.findOne({ tool: 'get_order' });
      expect(audit!.ok).toBe(false);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 after AGENT_RATE_LIMIT_PER_HOUR user messages', async () => {
      const user = await User.findOne({ email: adminEmail });
      const conversationId = new Types.ObjectId();

      await AgentMessage.create(
        Array.from({ length: 40 }, (_, index) => ({
          conversationId,
          userId: user!._id,
          role: 'user',
          content: `consulta ${index}`
        }))
      );

      const res = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: 'una más' });

      expect(res.status).toBe(429);
      expect(res.body.error).toContain('límite');
      expect(providerMock.callProvider).not.toHaveBeenCalled();
    });
  });

  describe('clear chat', () => {
    it('deletes messages but keeps the audit trail', async () => {
      providerMock.callProvider
        .mockResolvedValueOnce(assistant(null, [toolCall('call_1', 'get_receivables', {})]))
        .mockResolvedValueOnce(assistant('No hay deuda vencida.'));

      await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: '¿Deuda vencida?' })
        .expect(200);

      expect(await AgentMessage.countDocuments({})).toBe(2);
      expect(await AgentToolCall.countDocuments({})).toBe(1);

      const res = await request
        .delete('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken));

      expect(res.status).toBe(204);
      expect(await AgentMessage.countDocuments({})).toBe(0);
      expect(await AgentToolCall.countDocuments({})).toBe(1);

      const state = await request
        .get('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken));
      expect(state.body.messages).toEqual([]);
    });
  });

  /**
   * Phase 2: the assistant only PREPARES writes. Nothing is created until the
   * human confirms the action id; the client never sends the payload back.
   */
  describe('prepare → confirm write actions', () => {
    const confirmUrl = (id: string): string => `/api/v1/agent/actions/${id}/confirm`;
    const cancelUrl = (id: string): string => `/api/v1/agent/actions/${id}/cancel`;

    const prepareOrderViaChat = async (
      customerId: string,
      productId: string,
      quantity = 2
    ) => {
      providerMock.callProvider
        .mockResolvedValueOnce(
          assistant(null, [
            toolCall('call_prepare_order', 'prepare_order', {
              customerId,
              channel: 'phone',
              items: [{ productId, quantity, unit: 'maple' }]
            })
          ])
        )
        .mockResolvedValueOnce(assistant('Preparé el pedido. Confirmá la tarjeta para crearlo.'));

      const res = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: 'Prepará un pedido' });

      expect(res.status).toBe(200);
      const action = await AgentPendingAction.findOne({}).sort({ createdAt: -1 });
      return { res, action: action! };
    };

    /** Creates a pending order with a single maple line. */
    const createOrderForStatus = async (
      quantity = 2,
      productKey = 'blanco-chico'
    ): Promise<Awaited<ReturnType<typeof createOrder>>> => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      return createOrder({
        customerId: String(customer._id),
        channel: 'phone',
        items: [{ productId: ids[productKey]!, quantity, unit: 'maple' }]
      });
    };

    const prepareStatusViaChat = async (
      orderNumber: string,
      status: 'assigned' | 'in_transit' | 'delivered',
      token: string = adminToken
    ): Promise<{ res: supertest.Response; action: IAgentPendingAction | null }> => {
      providerMock.callProvider
        .mockResolvedValueOnce(
          assistant(null, [
            toolCall('call_prepare_status', 'prepare_order_status', { orderNumber, status })
          ])
        )
        .mockResolvedValueOnce(assistant('Preparé el cambio de estado. Confirmá la tarjeta.'));

      const res = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(token))
        .send({ message: 'Cambiá el estado del pedido' });

      const action = await AgentPendingAction.findOne({ type: 'change_order_status' }).sort({
        createdAt: -1
      });
      return { res, action };
    };

    it('prepare_order stores a pending action and does not create an order', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();

      const { res, action } = await prepareOrderViaChat(
        String(customer._id),
        ids['castaño-grande']!,
        2
      );

      expect(action.type).toBe('create_order');
      expect(action.status).toBe('pending');
      expect(action.preview).toContain('Test Customer');
      expect(action.preview).toContain('estimado');
      expect(await Order.countDocuments()).toBe(0);

      expect(res.body.actions).toHaveLength(1);
      expect(res.body.actions[0].id).toBe(String(action._id));
    });

    it('exposes the actionId to the model and asks the user to confirm', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();

      const { res, action } = await prepareOrderViaChat(
        String(customer._id),
        ids['blanco-chico']!,
        1
      );

      const secondRoundMessages = providerMock.callProvider.mock.calls[1]?.[0] as ProviderMessage[];
      const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
      expect(toolMessage).toBeDefined();
      expect(toolMessage?.content).toContain(String(action._id));
      expect(res.body.reply.toLowerCase()).toContain('confirm');
    });

    it('confirm creates exactly one order; a second confirm returns 409', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);
      const id = String(action._id);

      const first = await request
        .post(confirmUrl(id))
        .set('Authorization', bearer(adminToken));

      expect(first.status).toBe(200);
      expect(first.body.action.status).toBe('confirmed');
      expect(first.body.action.resultSummary).toContain('ORD-');
      expect(first.body.action.resultRef).toMatchObject({ entity: 'order' });

      const orders = await Order.find({});
      expect(orders).toHaveLength(1);
      expect(orders[0]!.totalAmount).toBe(50);

      const second = await request
        .post(confirmUrl(id))
        .set('Authorization', bearer(adminToken));
      expect(second.status).toBe(409);
      expect(await Order.countDocuments()).toBe(1);

      // The result is appended to the conversation for the next turn.
      const assistantMessages = await AgentMessage.find({ role: 'assistant' });
      expect(assistantMessages.some((message) => message.content.includes('✅'))).toBe(true);
    });

    it('cancel marks the action cancelled and a later confirm returns 409', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);
      const id = String(action._id);

      const cancelled = await request
        .post(cancelUrl(id))
        .set('Authorization', bearer(adminToken));

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.action.status).toBe('cancelled');

      const confirm = await request
        .post(confirmUrl(id))
        .set('Authorization', bearer(adminToken));
      expect(confirm.status).toBe(409);
      expect(await Order.countDocuments()).toBe(0);
    });

    it('an expired action returns 410 and becomes expired', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);
      const id = String(action._id);

      await AgentPendingAction.updateOne(
        { _id: action._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );

      const confirm = await request
        .post(confirmUrl(id))
        .set('Authorization', bearer(adminToken));
      expect(confirm.status).toBe(410);

      const expired = await AgentPendingAction.findById(action._id);
      expect(expired!.status).toBe('expired');
      expect(await Order.countDocuments()).toBe(0);
    });

    it('another user cannot see or confirm the action (404)', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);

      const otherPassword = 'otherpassword';
      const other = await User.create({
        name: 'Other Admin',
        email: 'other@test.com',
        passwordHash: await bcrypt.hash(otherPassword, 10),
        role: 'admin',
        permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.admin]
      });
      await indexTestUser('other@test.com', other._id);
      const otherToken = await loginAs(request, 'other@test.com', otherPassword);

      const get = await request
        .get(`/api/v1/agent/actions/${String(action._id)}`)
        .set('Authorization', bearer(otherToken));
      expect(get.status).toBe(404);

      const confirm = await request
        .post(confirmUrl(String(action._id)))
        .set('Authorization', bearer(otherToken));
      expect(confirm.status).toBe(404);
      expect(await Order.countDocuments()).toBe(0);
    });

    it('re-checks permission at confirm time and fails the action when it was lost', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);

      await User.updateOne(
        { email: adminEmail },
        { $set: { permissions: ['orders.view', 'customers.view'] } }
      );

      const confirm = await request
        .post(confirmUrl(String(action._id)))
        .set('Authorization', bearer(adminToken));

      expect(confirm.status).toBe(403);
      expect(confirm.body.error).toContain('Sin permiso');

      const failed = await AgentPendingAction.findById(action._id);
      expect(failed!.status).toBe('failed');
      expect(await Order.countDocuments()).toBe(0);
    });

    it('prepare_payment shows the balance and confirm registers the payment', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const order = await createOrder({
        customerId: String(customer._id),
        channel: 'phone',
        items: [{ productId: ids['blanco-chico']!, quantity: 2, unit: 'maple' }]
      });
      expect(order.balance).toBe(50);

      providerMock.callProvider
        .mockResolvedValueOnce(
          assistant(null, [
            toolCall('call_prepare_payment', 'prepare_payment', {
              orderNumber: order.orderNumber,
              amount: 20,
              method: 'cash'
            })
          ])
        )
        .mockResolvedValueOnce(assistant('Preparé el pago. Confirmá la tarjeta para registrarlo.'));

      const chatRes = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: 'Registrá un pago' });
      expect(chatRes.status).toBe(200);

      const action = await AgentPendingAction.findOne({ type: 'register_payment' });
      expect(action).not.toBeNull();
      expect(action!.preview).toContain('Saldo actual');
      expect(action!.preview).toContain('$50');

      const confirm = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(adminToken));
      expect(confirm.status).toBe(200);
      expect(confirm.body.action.resultRef).toMatchObject({ entity: 'payment' });

      expect(await Payment.countDocuments()).toBe(1);
      const updated = await Order.findById(order._id);
      expect(updated!.paidAmount).toBe(20);
      expect(updated!.balance).toBe(30);
    });

    it('prepare_customer confirm creates the customer', async () => {
      providerMock.callProvider
        .mockResolvedValueOnce(
          assistant(null, [
            toolCall('call_prepare_customer', 'prepare_customer', {
              name: 'Panadería Nueva',
              type: 'B2B',
              phone: '+5491100000000',
              address: 'Av. Siempre Viva 742',
              creditLimit: 5000,
              termDays: 30
            })
          ])
        )
        .mockResolvedValueOnce(assistant('Preparé el cliente. Confirmá la tarjeta para crearlo.'));

      const chatRes = await request
        .post('/api/v1/agent/chat')
        .set('Authorization', bearer(adminToken))
        .send({ message: 'Creá el cliente Panadería Nueva' });
      expect(chatRes.status).toBe(200);

      const action = await AgentPendingAction.findOne({ type: 'create_customer' });
      expect(action).not.toBeNull();
      expect(action!.preview).toContain('Crear cliente Panadería Nueva');
      expect(action!.preview).toContain('Límite de crédito');

      const confirm = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(adminToken));
      expect(confirm.status).toBe(200);
      expect(confirm.body.action.resultRef).toMatchObject({ entity: 'customer' });

      const created = await Customer.findOne({ name: 'Panadería Nueva' });
      expect(created).not.toBeNull();
      expect(created!.creditConfig.limit).toBe(5000);
      expect(created!.creditConfig.termDays).toBe(30);
    });

    // ── change_order_status (prepare → confirm) ──────────────────────────────

    it('prepare_order_status stores a pending action without changing the order', async () => {
      const order = await createOrderForStatus(2);

      const { res, action } = await prepareStatusViaChat(order.orderNumber, 'assigned');

      expect(res.status).toBe(200);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('change_order_status');
      expect(action!.status).toBe('pending');
      expect(action!.preview).toContain(order.orderNumber);
      expect(action!.preview).toContain('Pendiente');
      expect(action!.preview).toContain('Asignado');

      const unchanged = await Order.findById(order._id);
      expect(unchanged!.status).toBe('pending');
      expect(res.body.actions).toHaveLength(1);
    });

    it('rejects a non-forward transition (409) and creates no action', async () => {
      const order = await createOrderForStatus(2);

      // Via the tool: the model receives an error and no card is created.
      const { res, action } = await prepareStatusViaChat(order.orderNumber, 'delivered');
      expect(res.status).toBe(200);
      expect(res.body.toolCalls[0]).toMatchObject({ name: 'prepare_order_status', ok: false });
      expect(action).toBeNull();
      expect((await Order.findById(order._id))!.status).toBe('pending');

      const ctx = { userId: 'u', conversationId: 'c', messageId: 'm' };

      // pending → delivered (skips steps) is a 409.
      await expect(
        prepareOrderStatusAction({ orderNumber: order.orderNumber, status: 'delivered' }, ctx)
      ).rejects.toMatchObject({ status: 409 });

      // assigned → assigned (same status) is a 409.
      await Order.updateOne({ _id: order._id }, { $set: { status: 'assigned' } });
      await expect(
        prepareOrderStatusAction({ orderNumber: order.orderNumber, status: 'assigned' }, ctx)
      ).rejects.toMatchObject({ status: 409 });

      expect(await AgentPendingAction.countDocuments({ type: 'change_order_status' })).toBe(0);
    });

    it('confirm pending → assigned changes the status without touching stock', async () => {
      const order = await createOrderForStatus(2);
      const productId = order.items[0]!.productId;
      const before = await Inventory.findOne({ productId });

      const { action } = await prepareStatusViaChat(order.orderNumber, 'assigned');
      const confirm = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(adminToken));

      expect(confirm.status).toBe(200);
      expect(confirm.body.action.status).toBe('confirmed');
      expect(confirm.body.action.resultSummary).toContain('ahora está Asignado');
      expect(confirm.body.action.resultRef).toMatchObject({ entity: 'order' });

      const updated = await Order.findById(order._id);
      expect(updated!.status).toBe('assigned');
      expect(updated!.stockDeducted).toBe(false);

      const after = await Inventory.findOne({ productId });
      expect(after!.quantity).toBe(before!.quantity);
    });

    it('confirm in_transit → delivered deducts stock once; a second confirm is 409', async () => {
      const order = await createOrderForStatus(2);
      await Order.updateOne({ _id: order._id }, { $set: { status: 'in_transit' } });
      const productId = order.items[0]!.productId;

      expect((await Inventory.findOne({ productId }))!.quantity).toBe(100);

      const { action } = await prepareStatusViaChat(order.orderNumber, 'delivered');
      const confirm = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(adminToken));

      expect(confirm.status).toBe(200);
      expect(confirm.body.action.resultSummary).toContain('ahora está Entregado');

      const updated = await Order.findById(order._id);
      expect(updated!.status).toBe('delivered');
      expect(updated!.stockDeducted).toBe(true);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(98);

      // The atomic claim guarantees a second confirm never double-applies.
      const second = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(adminToken));
      expect(second.status).toBe(409);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(98);
    });

    it('delivery with insufficient stock: prepare warns, confirm fails and nothing changes', async () => {
      const order = await createOrderForStatus(5);
      await Order.updateOne({ _id: order._id }, { $set: { status: 'in_transit' } });
      const productId = order.items[0]!.productId;
      await Inventory.updateOne({ productId }, { $set: { quantity: 1 } });

      const { action } = await prepareStatusViaChat(order.orderNumber, 'delivered');
      expect(action).not.toBeNull();
      expect(action!.preview).toContain('Stock insuficiente');
      expect(action!.preview).toContain('hay 1');
      expect(action!.preview).toContain('se necesitan 5');

      const confirm = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(adminToken));
      expect(confirm.status).toBe(409);
      expect(confirm.body.error).toContain('Stock insuficiente');

      const failed = await AgentPendingAction.findById(action!._id);
      expect(failed!.status).toBe('failed');

      const updated = await Order.findById(order._id);
      expect(updated!.status).toBe('in_transit');
      expect(updated!.stockDeducted).toBe(false);
      expect((await Inventory.findOne({ productId }))!.quantity).toBe(1);
    });

    it('another user cannot confirm a change_order_status action (404)', async () => {
      const order = await createOrderForStatus(2);
      const { action } = await prepareStatusViaChat(order.orderNumber, 'assigned');

      const otherPassword = 'otherpassword';
      const other = await User.create({
        name: 'Other Admin',
        email: 'other@test.com',
        passwordHash: await bcrypt.hash(otherPassword, 10),
        role: 'admin',
        permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.admin]
      });
      await indexTestUser('other@test.com', other._id);
      const otherToken = await loginAs(request, 'other@test.com', otherPassword);

      const confirm = await request
        .post(confirmUrl(String(action!._id)))
        .set('Authorization', bearer(otherToken));

      expect(confirm.status).toBe(404);
      expect((await Order.findById(order._id))!.status).toBe('pending');
    });

    it('an admin without orders.manage cannot prepare a status change', async () => {
      const order = await createOrderForStatus(2);

      await User.updateOne(
        { email: adminEmail },
        { $set: { permissions: ['orders.view', 'customers.view'] } }
      );
      const restrictedToken = await loginAs(request, adminEmail, adminPassword);

      const { res, action } = await prepareStatusViaChat(
        order.orderNumber,
        'assigned',
        restrictedToken
      );

      expect(res.status).toBe(200);
      expect(res.body.toolCalls[0]).toMatchObject({ name: 'prepare_order_status', ok: false });
      expect(action).toBeNull();

      const secondRoundMessages = providerMock.callProvider.mock.calls[1]?.[0] as ProviderMessage[];
      const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toContain('Sin permiso');
      expect(toolMessage?.content).not.toContain('orders.manage');
      expect((await Order.findById(order._id))!.status).toBe('pending');
    });

    it('delivery preview lists the stock impact in maples', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const order = await createOrder({
        customerId: String(customer._id),
        channel: 'phone',
        items: [
          { productId: ids['castaño-grande']!, quantity: 24, unit: 'maple' },
          { productId: ids['blanco-chico']!, quantity: 10, unit: 'maple' }
        ]
      });
      await Order.updateOne({ _id: order._id }, { $set: { status: 'in_transit' } });

      const { action } = await prepareStatusViaChat(order.orderNumber, 'delivered');

      expect(action).not.toBeNull();
      expect(action!.preview).toContain('Se descontará stock:');
      expect(action!.preview).toContain('24 maples de Castaño Grande');
      expect(action!.preview).toContain('10 maples de Blanco Chico');
      expect((await Order.findById(order._id))!.status).toBe('in_transit');
    });

    it('confirm ignores any payload sent by the client (only the id is used)', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);

      const confirm = await request
        .post(confirmUrl(String(action._id)))
        .set('Authorization', bearer(adminToken))
        .send({
          items: [{ productId: ids['castaño-grande'], quantity: 100, unit: 'maple' }],
          totalAmount: 1,
          payload: { customerId: 'hacked' }
        });

      expect(confirm.status).toBe(200);
      const orders = await Order.find({});
      expect(orders).toHaveLength(1);
      expect(orders[0]!.items[0]!.quantity).toBe(2);
      expect(orders[0]!.totalAmount).toBe(50);
    });

    it('audits every confirm attempt in AgentToolCall', async () => {
      const customer = await createTestCustomer();
      const ids = await getProductIds();
      const { action } = await prepareOrderViaChat(String(customer._id), ids['blanco-chico']!, 2);
      const id = String(action._id);

      await request.post(confirmUrl(id)).set('Authorization', bearer(adminToken)).expect(200);
      await request.post(confirmUrl(id)).set('Authorization', bearer(adminToken)).expect(409);

      const audit = await AgentToolCall.find({ tool: 'confirm_action' }).sort({ createdAt: 1 });
      expect(audit).toHaveLength(2);
      expect(audit[0]!.ok).toBe(true);
      expect(audit[1]!.ok).toBe(false);
      expect(audit[1]!.args).toMatchObject({ actionId: id, type: 'create_order' });
    });
  });


  it.skip('does not return another tenant\'s messages (covered by tenant-isolation.test.ts)', () => {
    // Intentionally skipped — see comment above.
  });
});
