import { Schema } from 'mongoose';
import { createScopedModel } from '../../tenancy/scoped-model.js';

export interface ICounter {
  _id: string;
  seq: number;
}

export const counterSchema = new Schema<ICounter>({
  _id: { type: String },
  seq: { type: Number, default: 0 }
});

export const Counter = createScopedModel<ICounter>('Counter', counterSchema);

/**
 * Atomically increments and returns the next sequence number for the given counter name.
 * Uses MongoDB findOneAndUpdate with $inc for concurrency safety.
 *
 * @param name - Counter identifier (e.g. 'order-20260901')
 * @returns The new sequence number after increment
 */
export const getNextSequence = async (name: string): Promise<number> => {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

/**
 * Generates a formatted order number: ORD-YYYYMMDD-###
 * Uses the counters collection for atomic, restart-safe sequencing.
 */
export const getNextOrderNumber = async (): Promise<string> => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const counterName = `order-${dateStr}`;
  const seq = await getNextSequence(counterName);
  const padded = String(seq).padStart(3, '0');
  return `ORD-${dateStr}-${padded}`;
};

/**
 * Generates a formatted route number: RTE-YYYYMMDD-###
 * Uses the counters collection for atomic, restart-safe sequencing.
 */
export const getNextRouteNumber = async (): Promise<string> => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const counterName = `route-${dateStr}`;
  const seq = await getNextSequence(counterName);
  const padded = String(seq).padStart(3, '0');
  return `RTE-${dateStr}-${padded}`;
};

/**
 * Generates a formatted purchase number: PUR-YYYYMMDD-###
 * Uses the counters collection for atomic, restart-safe sequencing.
 */
export const getNextPurchaseNumber = async (): Promise<string> => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const counterName = `purchase-${dateStr}`;
  const seq = await getNextSequence(counterName);
  const padded = String(seq).padStart(3, '0');
  return `PUR-${dateStr}-${padded}`;
};
