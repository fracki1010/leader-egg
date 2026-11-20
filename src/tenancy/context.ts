import { AsyncLocalStorage } from 'node:async_hooks';
import type { Connection } from 'mongoose';

/**
 * Per-request tenancy context carried through the async call stack.
 *
 * `connection` is the tenant-scoped Mongoose connection; `tenantId` identifies
 * the tenant (null only for non-tenant / master operations such as scripts).
 */
export interface TenancyContext {
  connection: Connection;
  tenantId: string | null;
}

const als = new AsyncLocalStorage<TenancyContext>();

/** Returns the full tenancy context for the current async scope, if any. */
export const getTenancy = (): TenancyContext | undefined => als.getStore();

/**
 * Returns the connection bound to the current async scope.
 *
 * `undefined` when there is no tenancy context — callers should fall back to
 * `mongoose.connection` (the master/default connection).
 */
export const getCurrentConnection = (): Connection | undefined => als.getStore()?.connection;

/** Runs `fn` with the given tenancy context bound to the async scope. */
export const runWithTenancy = <T>(ctx: TenancyContext, fn: () => T): T => als.run(ctx, fn);
