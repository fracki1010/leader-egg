/**
 * In-process, per-conversation serialization for inbound WhatsApp work.
 *
 * Tasks sharing a key run one after another in enqueue order, so two messages
 * from the same phone never interleave their turns. Different keys run
 * concurrently. State lives in this process: ordering holds per replica, and
 * the deployment runs a single API replica.
 *
 * Tasks own their error handling. A failing task is swallowed here so the
 * lane keeps draining instead of wedging every later message for that key.
 */

type Task = () => Promise<void>;

const lanes = new Map<string, Promise<void>>();

export const enqueue = (key: string, task: Task): void => {
  const previous = lanes.get(key) ?? Promise.resolve();

  const run = previous.then(task).catch(() => undefined);
  const tail: Promise<void> = run.finally(() => {
    if (lanes.get(key) === tail) {
      lanes.delete(key);
    }
  });

  lanes.set(key, tail);
};

/** Resolves once every queued task, including tasks queued while waiting, has settled. */
export const waitForIdle = async (): Promise<void> => {
  while (lanes.size > 0) {
    await Promise.all([...lanes.values()]);
  }
};
