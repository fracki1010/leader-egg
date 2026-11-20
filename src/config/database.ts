import mongoose, { type Connection } from 'mongoose';
import { assertPlatformDbSafe } from '../tenancy/master.js';

export const connectDatabase = async (uri: string): Promise<void> => {
  await mongoose.connect(uri);
  // Fail fast on a misconfigured PLATFORM_DB (collides with the base DB, uses
  // the reserved `tenant_` prefix, or shadows a reserved tenant database).
  assertPlatformDbSafe();
};

export const disconnectDatabase = async (): Promise<void> => {
  // Collect every top-level connection AND the cached tenant connections
  // created via `connection.useDb(..., { useCache: true })` (those live in
  // `relatedDbs`, not in `mongoose.connections`).
  const connections = new Set<Connection>();
  for (const conn of mongoose.connections) {
    connections.add(conn);
    // `relatedDbs` holds connections created via `useDb(..., { useCache: true })`.
    // It is not part of the public typings, hence the cast.
    const related = (conn as unknown as { relatedDbs?: Record<string, Connection> }).relatedDbs;
    for (const child of Object.values(related ?? {})) {
      connections.add(child);
    }
  }

  for (const conn of connections) {
    if (conn.readyState !== 0) {
      await conn.close();
    }
  }
};

export const isDatabaseReady = (): boolean => mongoose.connection.readyState === 1;
