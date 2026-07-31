import { HealthIndicatorService } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from './database.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';
import {
  DATABASE_INDICATOR_KEY,
  REDIS_INDICATOR_KEY,
} from './health.constants';

/**
 * These exercise the indicators without a live PostgreSQL or Redis by
 * replacing the private client with a fake. That keeps the unit suite
 * runnable on a laptop with nothing started, while the e2e suite covers the
 * wiring and the integration suite (sprint 03) will cover a real round trip.
 */
interface DatabaseInternals {
  pool: { query: jest.Mock; on: jest.Mock; end: jest.Mock };
}
interface RedisInternals {
  connectedClient: () => Promise<{ ping: jest.Mock }>;
}

const indicatorService = new HealthIndicatorService();

describe('DatabaseHealthIndicator', () => {
  function makeIndicator(query: jest.Mock): DatabaseHealthIndicator {
    const indicator = new DatabaseHealthIndicator(
      indicatorService,
      'postgresql://user:hunter2@localhost:5432/db',
    );
    (indicator as unknown as DatabaseInternals).pool = {
      query,
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };
    return indicator;
  }

  it('reports up when SELECT 1 succeeds', async () => {
    const indicator = makeIndicator(jest.fn().mockResolvedValue({ rows: [] }));

    const result = await indicator.isHealthy();

    expect(result[DATABASE_INDICATOR_KEY]?.status).toBe('up');
  });

  it('reports down instead of throwing when the query fails', async () => {
    const indicator = makeIndicator(
      jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    const result = await indicator.isHealthy();

    expect(result[DATABASE_INDICATOR_KEY]?.status).toBe('down');
    expect(result[DATABASE_INDICATOR_KEY]?.reason).toBe('unreachable');
  });

  /** The result is served over HTTP; the connection string must not be in it. */
  it('never leaks the connection string or driver message', async () => {
    const indicator = makeIndicator(
      jest
        .fn()
        .mockRejectedValue(
          new Error('connect ECONNREFUSED postgresql://user:hunter2@host'),
        ),
    );

    const result = await indicator.isHealthy();

    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(result)).not.toContain('postgresql://');
  });

  it('proves the query path, not merely that a socket opened', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await makeIndicator(query).isHealthy();

    expect(query).toHaveBeenCalledWith('SELECT 1');
  });
});

describe('RedisHealthIndicator', () => {
  function makeIndicator(ping: jest.Mock): RedisHealthIndicator {
    const indicator = new RedisHealthIndicator(
      indicatorService,
      'redis://:hunter2@localhost:6379/0',
    );
    (indicator as unknown as RedisInternals).connectedClient = () =>
      Promise.resolve({ ping });
    return indicator;
  }

  it('reports up when PING succeeds', async () => {
    const result = await makeIndicator(
      jest.fn().mockResolvedValue('PONG'),
    ).isHealthy();

    expect(result[REDIS_INDICATOR_KEY]?.status).toBe('up');
  });

  it('reports down instead of throwing when PING fails', async () => {
    const result = await makeIndicator(
      jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    ).isHealthy();

    expect(result[REDIS_INDICATOR_KEY]?.status).toBe('down');
    expect(result[REDIS_INDICATOR_KEY]?.reason).toBe('unreachable');
  });

  it('never leaks the Redis URL, which carries the password', async () => {
    const result = await makeIndicator(
      jest.fn().mockRejectedValue(new Error('WRONGPASS redis://:hunter2@host')),
    ).isHealthy();

    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('uses PING, so a probe can never disturb application state', async () => {
    const ping = jest.fn().mockResolvedValue('PONG');
    await makeIndicator(ping).isHealthy();

    expect(ping).toHaveBeenCalledTimes(1);
  });
});
