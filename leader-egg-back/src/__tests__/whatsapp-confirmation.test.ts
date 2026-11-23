import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase, getTestTenantId } from './helpers.js';
import { Tenant } from '../tenancy/master-models.js';
import { getTenantConnection } from '../tenancy/registry.js';
import { runWithTenancy } from '../tenancy/context.js';
import { AppError } from '../middleware/error-handler.js';
import { AgentPendingAction } from '../modules/agent/model.js';
import { confirmAction, cancelAction } from '../modules/agent/actions.js';
import { handleDecision, parseDecision } from '../modules/whatsapp/confirmation.js';

vi.mock('../modules/agent/actions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/agent/actions.js')>()),
  confirmAction: vi.fn(async () => ({ resultSummary: 'Pago registrado.' })),
  cancelAction: vi.fn(async () => ({}))
}));

const USER_ID = new Types.ObjectId();
const caller = { userId: String(USER_ID), role: 'admin', permissions: ['orders.manage'] };
const CHAT = '5491155550099@s.whatsapp.net';
const OTHER_CHAT = '5491155550088@s.whatsapp.net';
const inFiveMinutes = () => new Date(Date.now() + 5 * 60 * 1000);
const tenDaysAgo = () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

describe('parseDecision', () => {
  it('reads sí and no regardless of case, accents or final punctuation', () => {
    expect(parseDecision('sí')).toBe('yes');
    expect(parseDecision('Si.')).toBe('yes');
    expect(parseDecision('  NO!  ')).toBe('no');
  });

  it('does not treat anything else as a decision', () => {
    expect(parseDecision('quizás')).toBeNull();
    expect(parseDecision('no me digas que no')).toBeNull();
  });
});

describe('handleDecision', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(confirmAction).mockClear();
    vi.mocked(cancelAction).mockClear();
  });

  /** Runs `fn` inside the test tenant's connection, as the turn does. */
  const inTenant = async <T>(fn: () => Promise<T>): Promise<T> => {
    const tenant = await Tenant.findById(getTestTenantId());
    const connection = getTenantConnection(tenant!.dbName);
    return runWithTenancy({ connection, tenantId: String(tenant!._id) }, fn);
  };

  const seedPending = (preview: string, expiresAt: Date, createdAt = new Date(), channelChatId: string | null = CHAT) =>
    inTenant(() =>
      AgentPendingAction.create({
        userId: USER_ID,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'register_payment',
        payload: {},
        preview,
        channelChatId,
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt,
        createdAt
      })
    );

  it('says there is nothing to confirm when nothing is pending, and confirms nothing', async () => {
    expect(await inTenant(() => handleDecision(caller, 'yes', CHAT))).toBe('No hay nada para confirmar.');
    expect(confirmAction).not.toHaveBeenCalled();
    expect(cancelAction).not.toHaveBeenCalled();
  });

  it('does not confirm an action prepared in another chat', async () => {
    await seedPending('Cobro de $100', inFiveMinutes(), new Date(), OTHER_CHAT);

    const reply = await inTenant(() => handleDecision(caller, 'yes', CHAT));

    expect(confirmAction).not.toHaveBeenCalled();
    expect(reply).toBe('No hay nada para confirmar.');
  });

  it('does not confirm an action prepared in the app, from WhatsApp', async () => {
    await seedPending('Cobro de $100', inFiveMinutes(), new Date(), null);

    const reply = await inTenant(() => handleDecision(caller, 'yes', CHAT));

    expect(confirmAction).not.toHaveBeenCalled();
    expect(reply).toBe('No hay nada para confirmar.');
  });

  it('confirms the single live pending action on sí', async () => {
    const action = await seedPending('Cobro de $100', inFiveMinutes());

    const reply = await inTenant(() => handleDecision(caller, 'yes', CHAT));

    expect(confirmAction).toHaveBeenCalledWith(caller.userId, 'admin', ['orders.manage'], String(action._id));
    expect(reply).toBe('Pago registrado.');
  });

  it('cancels the single live pending action on no', async () => {
    const action = await seedPending('Cobro de $100', inFiveMinutes());

    const reply = await inTenant(() => handleDecision(caller, 'no', CHAT));

    expect(cancelAction).toHaveBeenCalledWith(caller.userId, String(action._id));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(reply).toBe('Acción cancelada.');
  });

  it('confirms nothing when more than one action is live, and lists them', async () => {
    await seedPending('Cobro de $100', inFiveMinutes());
    await seedPending('Cobro de $250', inFiveMinutes());

    const reply = await inTenant(() => handleDecision(caller, 'yes', CHAT));

    expect(confirmAction).not.toHaveBeenCalled();
    expect(reply).toContain('2 acciones pendientes');
    expect(reply).toContain('Cobro de $100');
    expect(reply).toContain('Cobro de $250');
  });

  it('refuses an expired action with the reason from confirmAction', async () => {
    await seedPending('Cobro de $100', tenDaysAgo());
    vi.mocked(confirmAction).mockRejectedValueOnce(new AppError('La acción expiró', 410));

    const reply = await inTenant(() => handleDecision(caller, 'yes', CHAT));

    expect(reply).toBe('La acción expiró');
  });
});
