import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { startTestDatabase, stopTestDatabase, clearDatabase } from './helpers.js';
import { buildDateContext } from '../modules/agent/date-context.js';
import { buildSystemPrompt, chat } from '../modules/agent/service.js';
import type { ProviderAssistantMessage, ProviderMessage } from '../modules/agent/provider.js';

const providerMock = vi.hoisted(() => ({
  isAgentEnabled: vi.fn(),
  callProvider: vi.fn()
}));

vi.mock('../modules/agent/provider.js', () => ({
  isAgentEnabled: providerMock.isAgentEnabled,
  callProvider: providerMock.callProvider
}));

describe('buildDateContext (America/Argentina/Buenos_Aires)', () => {
  it('uses the ART calendar day, not the UTC day, just after UTC midnight', () => {
    // 02:30 UTC on 20/11 is 23:30 on 19/11 in Buenos Aires (UTC-3).
    const context = buildDateContext(new Date('2026-11-20T02:30:00Z'));

    expect(context.isoDate).toBe('2026-11-19');
    expect(context.tomorrowIsoDate).toBe('2026-11-20');
    expect(context.timezone).toBe('America/Argentina/Buenos_Aires');
  });

  it('rolls tomorrow over the end of the month', () => {
    const context = buildDateContext(new Date('2026-11-30T15:00:00Z'));

    expect(context.isoDate).toBe('2026-11-30');
    expect(context.tomorrowIsoDate).toBe('2026-12-01');
  });
});

describe('buildSystemPrompt', () => {
  it('injects today, tomorrow and the timezone so relative dates resolve', () => {
    const prompt = buildSystemPrompt(new Date('2026-11-20T15:00:00Z'));

    expect(prompt).toContain('Hoy es 2026-11-20 (zona horaria America/Argentina/Buenos_Aires)');
    expect(prompt).toContain('Mañana es 2026-11-21');
  });
});

describe('chat injects the current date on every turn', () => {
  let userId: Types.ObjectId;

  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    userId = new Types.ObjectId();
    providerMock.isAgentEnabled.mockReturnValue(true);
    providerMock.callProvider.mockReset();
    providerMock.callProvider.mockResolvedValue({
      role: 'assistant',
      content: 'ok'
    } satisfies ProviderAssistantMessage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the system prompt built from the time of each turn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(new Date('2026-11-20T15:00:00Z'));
    await chat(String(userId), 'Admin', [], '¿qué pasa mañana?');

    vi.setSystemTime(new Date('2026-12-01T15:00:00Z'));
    await chat(String(userId), 'Admin', [], '¿y hoy?');

    const systemPrompts = providerMock.callProvider.mock.calls.map(
      ([messages]) => (messages as ProviderMessage[])[0]?.content ?? ''
    );

    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[0]).toContain('Hoy es 2026-11-20');
    expect(systemPrompts[1]).toContain('Hoy es 2026-12-01');
  });
});
