import { describe, expect, it } from 'vitest';
import { enqueue, waitForIdle } from '../modules/whatsapp/queue.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('whatsapp queue', () => {
  it('serializes tasks that share a conversation key', async () => {
    const events: string[] = [];

    enqueue('tenant-a:541155551234', async () => {
      events.push('start-1');
      await sleep(30);
      events.push('end-1');
    });
    enqueue('tenant-a:541155551234', async () => {
      events.push('start-2');
      events.push('end-2');
    });

    await waitForIdle();

    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('runs different conversations concurrently', async () => {
    const events: string[] = [];

    enqueue('tenant-a:541155551234', async () => {
      events.push('start-a');
      await sleep(30);
      events.push('end-a');
    });
    enqueue('tenant-a:541166667777', async () => {
      events.push('start-b');
      events.push('end-b');
    });

    await waitForIdle();

    expect(events.indexOf('start-b')).toBeLessThan(events.indexOf('end-a'));
  });

  it('keeps the lane alive after a task fails', async () => {
    const events: string[] = [];

    enqueue('tenant-a:541155551234', async () => {
      throw new Error('boom');
    });
    enqueue('tenant-a:541155551234', async () => {
      events.push('next');
    });

    await waitForIdle();

    expect(events).toEqual(['next']);
  });

  it('resolves waitForIdle immediately when nothing is queued', async () => {
    await expect(waitForIdle()).resolves.toBeUndefined();
  });
});
