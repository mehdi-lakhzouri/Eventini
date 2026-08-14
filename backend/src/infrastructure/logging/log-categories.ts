/**
 * The `category` field — PINO_LOGGING_SPECIFICATION.md §8.
 *
 * The three classification fields answer different questions and must not be
 * collapsed into one another:
 *   - `level`     — how severe is it?
 *   - `category`  — what nature of thing is it?
 *   - `eventCode` — which exact event is it?
 */
export const LOG_CATEGORIES = [
  'SYSTEM',
  'HTTP_ACCESS',
  'APPLICATION',
  'BUSINESS',
  'SECURITY',
  'AUDIT',
  'DATABASE',
  'CACHE',
  'QUEUE',
  'REALTIME',
  'INTEGRATION',
  'PERFORMANCE',
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];
