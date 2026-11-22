import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InMemoryTokenBlacklist,
  RedisTokenBlacklist,
  createBlacklist
} from '../modules/auth/blacklist.js';

describe('TokenBlacklist', () => {
  describe('InMemoryTokenBlacklist', () => {
    let blacklist: InMemoryTokenBlacklist;

    beforeEach(() => {
      blacklist = new InMemoryTokenBlacklist();
    });

    it('add → has returns true', async () => {
      await blacklist.add('jti-1', 3600);
      expect(await blacklist.has('jti-1')).toBe(true);
    });

    it('has returns false for unknown jti', async () => {
      expect(await blacklist.has('unknown')).toBe(false);
    });

    it('clear → has returns false', async () => {
      await blacklist.add('jti-1', 3600);
      await blacklist.clear();
      expect(await blacklist.has('jti-1')).toBe(false);
    });
  });

  describe('RedisTokenBlacklist', () => {
    let mockRedis: {
      set: ReturnType<typeof vi.fn>;
      exists: ReturnType<typeof vi.fn>;
      keys: ReturnType<typeof vi.fn>;
      del: ReturnType<typeof vi.fn>;
    };
    let blacklist: RedisTokenBlacklist;

    beforeEach(() => {
      mockRedis = {
        set: vi.fn().mockResolvedValue('OK'),
        exists: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        del: vi.fn().mockResolvedValue(1)
      };
      blacklist = new RedisTokenBlacklist(mockRedis as any);
    });

    it('add calls redis.set with correct key and TTL', async () => {
      await blacklist.add('jti-abc', 7200);
      expect(mockRedis.set).toHaveBeenCalledWith('revoked:jti-abc', '1', 'EX', 7200);
    });

    it('add skips when TTL <= 0', async () => {
      await blacklist.add('jti-abc', 0);
      expect(mockRedis.set).not.toHaveBeenCalled();

      await blacklist.add('jti-def', -10);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('has calls redis.exists and returns boolean', async () => {
      mockRedis.exists.mockResolvedValue(1);
      expect(await blacklist.has('jti-abc')).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('revoked:jti-abc');

      mockRedis.exists.mockResolvedValue(0);
      expect(await blacklist.has('jti-xyz')).toBe(false);
    });

    it('clear deletes revoked:* keys', async () => {
      mockRedis.keys.mockResolvedValue(['revoked:a', 'revoked:b']);
      await blacklist.clear();
      expect(mockRedis.keys).toHaveBeenCalledWith('revoked:*');
      expect(mockRedis.del).toHaveBeenCalledWith('revoked:a', 'revoked:b');
    });

    it('clear is no-op when no keys exist', async () => {
      mockRedis.keys.mockResolvedValue([]);
      await blacklist.clear();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('createBlacklist factory', () => {
    it('returns InMemoryTokenBlacklist when REDIS_URL is undefined', () => {
      // env-setup.ts does not set REDIS_URL, so it should be undefined
      const blacklist = createBlacklist();
      expect(blacklist).toBeInstanceOf(InMemoryTokenBlacklist);
    });
  });
});
