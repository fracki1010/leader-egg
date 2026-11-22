/**
 * One-off index migration for the daily closes collection.
 *
 * The DailyClose model now enforces ONE close per (date, channel) instead of
 * one per date. The schema declares the new compound unique index, but an
 * EXISTING production database still has the old unique index on {date:1} —
 * dropping it must happen outside the code rollout because the old index
 * would keep rejecting the second (stall) close of the same day.
 *
 * This script:
 *   1. drops the old unique index on {date:1} (if present), and
 *   2. creates the unique index on {date:1, channel:1} (if missing).
 *
 * Existing closes keep their documents: the schema default 'reparto' backfills
 * the channel on read, so no document rewrite is needed.
 *
 * Usage (from leader-egg-back):
 *   npm run build
 *   MONGO_URI="mongodb://mongo:27017/leader_egg" node dist/scripts/daily-close-index-migration.js
 *   # or against a remote/Atlas URI:
 *   MONGO_URI="mongodb+srv://user:pass@host/leader_egg" node dist/scripts/daily-close-index-migration.js
 *
 * Idempotent — safe to run again (skips already-done steps).
 */
import '../config/setup.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const COLLECTION = 'dailycloses';
const NEW_INDEX_NAME = 'date_1_channel_1';

const run = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);
  console.log(`Connected to ${env.MONGO_URI}`);

  const collection = mongoose.connection.db!.collection(COLLECTION);
  const indexes = await collection.indexes();

  const oldDateIndex = indexes.find(
    (index) =>
      index.unique === true &&
      Object.keys(index.key).length === 1 &&
      (index.key as Record<string, unknown>).date === 1
  );

  if (oldDateIndex) {
    // Mongo always names indexes; fall back to the default {date:1} name.
    const indexName = oldDateIndex.name ?? 'date_1';
    await collection.dropIndex(indexName);
    console.log(`Dropped old unique index "${indexName}" on {date: 1}`);
  } else {
    console.log('No old unique {date: 1} index found — nothing to drop.');
  }

  const hasNewIndex = indexes.some((index) => index.name === NEW_INDEX_NAME);
  if (!hasNewIndex) {
    await collection.createIndex({ date: 1, channel: 1 }, { unique: true, name: NEW_INDEX_NAME });
    console.log(`Created unique index "${NEW_INDEX_NAME}" on {date: 1, channel: 1}`);
  } else {
    console.log(`Index "${NEW_INDEX_NAME}" already exists — nothing to create.`);
  }

  console.log('Final indexes on dailycloses:');
  for (const index of await collection.indexes()) {
    console.log(`  - ${index.name}: ${JSON.stringify(index.key)}${index.unique ? ' (unique)' : ''}`);
  }

  await mongoose.disconnect();
  console.log('Done');
};

run().catch((error: unknown) => {
  console.error('Index migration failed', error);
  process.exit(1);
});