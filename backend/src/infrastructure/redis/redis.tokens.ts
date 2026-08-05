/**
 * The five connections of REDIS_KEYS_AND_LUA_SCRIPTS.md §2, as injection
 * tokens.
 *
 * They are separate clients rather than one shared client because BullMQ puts
 * its connections into blocking mode (`BRPOPLPUSH`, `XREAD BLOCK`), and a
 * blocked connection cannot serve anything else. Sharing one would mean a
 * worker waiting for a job silently stalls every rate-limit check in the
 * process. The same applies to a subscriber: once a client is in subscribe
 * mode Redis only accepts a subset of commands on it.
 *
 * The databases are separate too, so a `FLUSHDB` aimed at queue state cannot
 * take the security counters with it.
 */
export const REDIS_APP = Symbol('REDIS_APP');
export const REDIS_BULLMQ_PRODUCER = Symbol('REDIS_BULLMQ_PRODUCER');
export const REDIS_BULLMQ_WORKER = Symbol('REDIS_BULLMQ_WORKER');
export const REDIS_PUBSUB_PUBLISHER = Symbol('REDIS_PUBSUB_PUBLISHER');
export const REDIS_PUBSUB_SUBSCRIBER = Symbol('REDIS_PUBSUB_SUBSCRIBER');

export const REDIS_CONNECTION_TOKENS = [
  REDIS_APP,
  REDIS_BULLMQ_PRODUCER,
  REDIS_BULLMQ_WORKER,
  REDIS_PUBSUB_PUBLISHER,
  REDIS_PUBSUB_SUBSCRIBER,
] as const;

/** Used as the `connectionName` Redis reports in `CLIENT LIST`. */
export const REDIS_CONNECTION_LABELS: Record<symbol, string> = {
  [REDIS_APP]: 'eventini-app',
  [REDIS_BULLMQ_PRODUCER]: 'eventini-bullmq-producer',
  [REDIS_BULLMQ_WORKER]: 'eventini-bullmq-worker',
  [REDIS_PUBSUB_PUBLISHER]: 'eventini-pubsub-publisher',
  [REDIS_PUBSUB_SUBSCRIBER]: 'eventini-pubsub-subscriber',
};
