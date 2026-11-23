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

  const seedPending = (preview: string, expiresAt: Date, createdAt = new Date()) =>
    inTenant(() =>
      AgentPendingAction.create({
        userId: USER_ID,
        conversationId: new Types.ObjectId(),
        messageId: new Types.ObjectId(),
        type: 'register_payment',
        payload: {},
        preview,
        idempotencyKey: new Types.ObjectId().toString(),
        expiresAt,
        createdAt
      })
    );

  it('returns null when nothing is pending, so the text goes to the agent', async () => {
    expect(await inTenant(() => handleDecision(caller, 'yes'))).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('confirms the single live pending action on sí', async () => {
    const action = await seedPending('Cobro de $100', inFiveMinutes());

    const reply = await inTenant(() => handleDecision(caller, 'yes'));

    expect(confirmAction).toHaveBeenCalledWith(caller.userId, 'admin', ['orders.manage'], String(action._id));
    expect(reply).toBe('Pago registrado.');
  });

  it('cancels the single live pending action on no', async () => {
    const action = await seedPending('Cobro de $100', inFiveMinutes());

    const reply = await inTenant(() => handleDecision(caller, 'no'));

    expect(cancelAction).toHaveBeenCalledWith(caller.userId, String(action._id));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(reply).toBe('Acción cancelada.');
  });

  it('confirms nothing when more than one action is live, and lists them', async () => {
    await seedPending('Cobro de $100', inFiveMinutes());
    await seedPending('Cobro de $250', inFiveMinutes());

    const reply = await inTenant(() => handleDecision(caller, 'yes'));

    expect(confirmAction).not.toHaveBeenCalled();
    expect(reply).toContain('2 acciones pendientes');
    expect(reply).toContain('Cobro de $100');
    expect(reply).toContain('Cobro de $250');
  });

  it('refuses an expired action with the reason from confirmAction', async () => {
    await seedPending('Cobro de $100', tenDaysAgo());
    vi.mocked(confirmAction).mockRejectedValueOnce(new AppError('La acción expiró', 410));

    const reply = await inTenant(() => handleDecision(caller, 'yes'));

    expect(reply).toBe('La acción expiró');
  });
});
