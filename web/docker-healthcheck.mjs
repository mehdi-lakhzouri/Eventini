/**
 * Container healthcheck for the Next.js server — sprint-02 EVT-013.
 *
 * Probes `/`, deliberately. Next.js has no built-in health endpoint, and the
 * root route is the one guaranteed to exist and to render without calling the
 * API. Pointing this at a page that fetches from the backend would restart
 * the web container every time the backend is briefly unavailable — the same
 * liveness/readiness confusion EVT-012 avoids on the API side, reached from
 * the other direction.
 *
 * Written in Node because the runtime image has no curl or wget, and adding
 * one would put a shell-capable HTTP client into an image that has none.
 */
import { get } from 'node:http';

const PORT = process.env.PORT ?? '3000';
const TIMEOUT_MS = 4_000;

const request = get(
  { host: '127.0.0.1', port: PORT, path: '/', timeout: TIMEOUT_MS },
  (response) => {
    // Drain the body; an unread socket stays open until the server times it
    // out, and a check every 30s would slowly accumulate them.
    response.resume();

    // Any non-5xx answer means the server is up and routing. A 404 would
    // still prove liveness, so only a server error — or no answer at all —
    // fails the check.
    const status = response.statusCode ?? 500;
    process.exit(status < 500 ? 0 : 1);
  },
);

request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});

request.on('error', () => {
  process.exit(1);
});
