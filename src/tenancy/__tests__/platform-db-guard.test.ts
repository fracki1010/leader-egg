import { describe, expect, it } from 'vitest';
import { assertPlatformDbSafety, assertPlatformDbSafe, platformDbName } from '../master.js';

/**
 * Boot-time guard for `PLATFORM_DB`.
 *
 * These are pure assertions (no database required): they prove the app refuses
 * to boot when the platform DB collides with the base connection, uses the
 * reserved `tenant_` prefix, or shadows a reserved tenant database.
 */
describe('assertPlatformDbSafety', () => {
  it('accepts a distinct platform database name', () => {
    expect(() => assertPlatformDbSafety('leader_egg_platform', 'leader_egg')).not.toThrow();
  });

  it('rejects a platform DB that collides with the base MONGO_URI database', () => {
    expect(() => assertPlatformDbSafety('leader_egg', 'leader_egg')).toThrow(/MONGO_URI/i);
  });

  it('rejects a platform DB using the reserved tenant_ prefix', () => {
    expect(() => assertPlatformDbSafety('tenant_acme', 'leader_egg')).toThrow(/tenant_/i);
  });

  it('rejects a platform DB that is a reserved tenant database name', () => {
    expect(() => assertPlatformDbSafety('leader_egg', 'some_other_base')).toThrow(/reserved/i);
  });

  it('skips the collision check when no base database name is known', () => {
    expect(() => assertPlatformDbSafety('leader_egg_platform', undefined)).not.toThrow();
  });
});

describe('assertPlatformDbSafe', () => {
  it('accepts the configured PLATFORM_DB against the primary tenant database', () => {
    expect(() => assertPlatformDbSafe('leader_egg')).not.toThrow();
  });

  it('rejects when the configured PLATFORM_DB collides with the base connection', () => {
    expect(() => assertPlatformDbSafe(platformDbName)).toThrow(/MONGO_URI/i);
  });
});
