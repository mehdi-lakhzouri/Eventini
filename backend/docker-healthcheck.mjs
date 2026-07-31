/**
 * Container healthcheck — sprint-02 EVT-013.
 *
 * Probes `/api/v1/health/live`, and only that. Liveness answers "is this
 * process still running", which is the sole question a container healthcheck
 * should ask, because the action Docker and every orchestrator take on
 * failure is to kill and restart. Pointing this at `/health/ready` would mean
 * a Redis outage restarts every container in a loop while Redis stays down —
 * the exact failure the live/ready split exists to prevent (EVT-012).
 *
 * Written in Node because the runtime image has no curl or wget. Adding one
 * would put a shell-capable HTTP client into an image that otherwise has
 * none: useful to an attacker, unnecessary here.
 */
import { get } from 'node:http';

const PORT = process.env.PORT ?? '3001';
const TIMEOUT_MS = 4_000;

const request = get(
  {
    host: '127.0.0.1',
    port: PORT,
    // The global prefix is part of the path: the route is mounted at
    // /api/v1/health/live, not /health/live.
    path: '/api/v1/health/live',
    timeout: TIMEOUT_MS,
  },
  (response) => {
    // Drain the body. Leaving the socket unread keeps the connection open
    // until the server times it out, and a healthcheck running every 30s
    // would slowly accumulate them.
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);

request.on('timeout', () => {
  // A hung request must fail the check rather than wait: an event loop
  // blocked long enough to miss this deadline is exactly what liveness is
  // meant to catch.
  request.destroy();
  process.exit(1);
});

request.on('error', () => {
  process.exit(1);
});
