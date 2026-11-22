import mongoose, { type Connection, type Model, type Schema } from 'mongoose';
import { getCurrentConnection } from './context.js';

export interface ScopedModelOptions {
  /** Custom collection name — mirrors the 3rd argument of `mongoose.model()`. */
  collection?: string;
}

/**
 * Resolves `name` on `conn`, compiling it from `schema` on first use.
 * Idempotent: the same connection always yields the same model instance.
 */
const resolveModel = <T>(
  conn: Connection,
  name: string,
  schema: Schema,
  options?: ScopedModelOptions
): Model<T> => {
  const existing = conn.models[name];
  if (existing) {
    return existing as unknown as Model<T>;
  }
  const model = options?.collection
    ? conn.model(name, schema, options.collection)
    : conn.model(name, schema);
  return model as unknown as Model<T>;
};

/** Plain callable target — all behaviour is delegated through the proxy traps. */
type ScopedTarget = (...args: never[]) => unknown;

/**
 * Creates a transparent proxy for a Mongoose model whose target connection is
 * resolved lazily on every property access via `resolveConnection`.
 *
 * The connection is resolved per-access (not captured at module load) so the
 * proxy works before `mongoose.connect()` has run and follows the active
 * tenancy context when that is the chosen resolver.
 *
 * This module intentionally imports NO model files to avoid circular imports.
 */
export const createResolvedModel = <T>(
  name: string,
  schema: Schema,
  resolveConnection: () => Connection,
  options?: ScopedModelOptions
): Model<T> => {
  const resolve = (): Model<T> =>
    resolveModel<T>(resolveConnection(), name, schema, options);

  const target: ScopedTarget = function scopedModelTarget(): void {
    /* never invoked directly */
  };

  const handler: ProxyHandler<ScopedTarget> = {
    get(_target, prop) {
      const model = resolve() as unknown as Record<PropertyKey, unknown>;
      const value = model[prop];
      // Bind methods to the real model so `this` is correct (e.g. `User.find`).
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(model)
        : value;
    },
    construct(_target, args) {
      const model = resolve() as unknown as new (...a: unknown[]) => object;
      return Reflect.construct(model, args);
    },
    apply(_target, thisArg, args) {
      const model = resolve() as unknown as (...a: unknown[]) => unknown;
      return Reflect.apply(model, thisArg, args);
    },
    has(_target, prop) {
      return prop in (resolve() as unknown as object);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve() as unknown as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(resolve() as unknown as object, prop);
    },
    set(_target, prop, value) {
      (resolve() as unknown as Record<PropertyKey, unknown>)[prop] = value;
      return true;
    }
  };

  return new Proxy(target, handler) as unknown as Model<T>;
};

/**
 * Creates a transparent, connection-scoped accessor for a Mongoose model.
 *
 * Models are BOUND to the connection they were compiled on, so this proxy
 * resolves the correct model lazily on every access:
 *
 * - inside `runWithTenancy(...)` → the tenant connection from AsyncLocalStorage
 * - otherwise → `mongoose.connection` (the master/default connection), so
 *   scripts and existing single-connection usage keep working unchanged.
 */
export const createScopedModel = <T>(
  name: string,
  schema: Schema,
  options?: ScopedModelOptions
): Model<T> =>
  createResolvedModel<T>(name, schema, () => getCurrentConnection() ?? mongoose.connection, options);
