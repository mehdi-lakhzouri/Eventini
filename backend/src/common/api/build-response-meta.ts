import type { ResponseMeta } from './problem-details.types';

/** The path prefix is the source of truth for the version — this just echoes it. */
const API_VERSION = 'v1';

export function buildResponseMeta(requestId: string): ResponseMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    apiVersion: API_VERSION,
  };
}
