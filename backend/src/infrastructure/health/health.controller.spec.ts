import { ServiceUnavailableException } from '@nestjs/common';
import type { HealthCheckService } from '@nestjs/terminus';

import type { DatabaseHealthIndicator } from './database.health-indicator';
import { HealthController } from './health.controller';
import type { RedisHealthIndicator } from './redis.health-indicator';
import { StartupState } from './startup.state';

const healthCheck = jest.fn();

function makeHealthService(): HealthCheckService {
  return { check: healthCheck } as unknown as HealthCheckService;
}

// The mocks are held as standalone references rather than read back off the
// indicator objects: reading a method off an object to assert on it is what
// `@typescript-eslint/unbound-method` flags, and separate handles are clearer
// to reset between tests anyway.
const databaseIsHealthy = jest.fn();
const redisIsHealthy = jest.fn();

const databaseIndicator = {
  isHealthy: databaseIsHealthy,
} as unknown as DatabaseHealthIndicator;
const redisIndicator = {
  isHealthy: redisIsHealthy,
} as unknown as RedisHealthIndicator;

describe('HealthController', () => {
  let health: HealthCheckService;
  let startup: StartupState;
  let controller: HealthController;

  beforeEach(() => {
    databaseIsHealthy.mockReset();
    redisIsHealthy.mockReset();
    healthCheck.mockReset();
    healthCheck.mockResolvedValue({ status: 'ok' });
    health = makeHealthService();
    startup = new StartupState();
    controller = new HealthController(
      health,
      databaseIndicator,
      redisIndicator,
      startup,
    );
  });

  describe('liveness', () => {
    it('answers ok', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
    });

    /**
     * The whole point of the live/ready split. If liveness consulted a
     * dependency, a Redis outage would make the orchestrator kill and restart
     * every pod in a loop while Redis stayed down — turning a degraded but
     * recoverable service into an outage.
     */
    it('checks no dependency at all', () => {
      controller.live();

      expect(healthCheck).not.toHaveBeenCalled();
      expect(databaseIsHealthy).not.toHaveBeenCalled();
      expect(redisIsHealthy).not.toHaveBeenCalled();
    });

    it('answers even before bootstrap has completed', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
    });
  });

  describe('readiness', () => {
    it('checks both PostgreSQL and Redis', async () => {
      await controller.ready();

      expect(healthCheck).toHaveBeenCalledTimes(1);
      const [indicators] = healthCheck.mock.calls[0] as [Array<() => unknown>];
      expect(indicators).toHaveLength(2);

      indicators.forEach((indicator) => indicator());
      expect(databaseIsHealthy).toHaveBeenCalled();
      expect(redisIsHealthy).toHaveBeenCalled();
    });
  });

  describe('startup', () => {
    it('refuses while the container is still being built', () => {
      expect(() => controller.startupProbe()).toThrow(
        ServiceUnavailableException,
      );
    });

    it('answers ok once onApplicationBootstrap has run', () => {
      startup.onApplicationBootstrap();

      expect(controller.startupProbe()).toEqual({ status: 'ok' });
    });

    /**
     * Mixing dependency checks in here would make a slow database look like a
     * failed boot and get the container killed during startup.
     */
    it('consults no dependency', () => {
      startup.onApplicationBootstrap();
      controller.startupProbe();

      expect(healthCheck).not.toHaveBeenCalled();
    });
  });
});

describe('StartupState', () => {
  it('starts false and flips on bootstrap', () => {
    const state = new StartupState();
    expect(state.hasStarted).toBe(false);

    state.onApplicationBootstrap();
    expect(state.hasStarted).toBe(true);
  });
});
