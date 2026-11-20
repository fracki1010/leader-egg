import './config/setup.js';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { getRedisClient } from './modules/auth/blacklist.js';
import { loadTenantCache } from './tenancy/tenants.js';

let server: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);

  try {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => error ? reject(error) : resolve());
    });
    const redis = getRedisClient();
    if (redis) {
      await redis.disconnect();
    }
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error('Graceful shutdown failed', error);
    process.exit(1);
  }
};

const start = async (): Promise<void> => {
  await connectDatabase(env.MONGO_URI);
  // Warm the tenant routing cache so authenticated requests resolve without a
  // first-miss refresh. Failures are non-fatal (the cache also self-heals).
  try {
    await loadTenantCache();
  } catch (error) {
    console.warn('Could not load tenant cache at boot:', (error as Error).message);
  }
  const redis = getRedisClient();
  if (redis) {
    await redis.connect();
    console.log('Redis connected');
  }
  server = app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT}`);
  });
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((error: unknown) => {
  console.error('Unable to start API', error);
  process.exit(1);
});
