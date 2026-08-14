import { strictestOf, type RateLimitDecision } from './rate-limit.decision';

const allow = (remaining: number, limit = 100): RateLimitDecision => ({
  allowed: true,
  limit,
  remaining,
  retryAfterSeconds: 0,
});

const refuse = (retryAfterSeconds: number, limit = 5): RateLimitDecision => ({
  allowed: false,
  limit,
  remaining: 0,
  retryAfterSeconds,
});

describe('strictestOf', () => {
  it('refuses as soon as any layer refuses', () => {
    expect(strictestOf([allow(99), refuse(30), allow(50)]).allowed).toBe(false);
  });

  /**
   * A client that honours `Retry-After` should not come back and be refused
   * again by a slower layer it had also exceeded. Reporting the shortest wait
   * would guarantee exactly that.
   */
  it('reports the longest wait among the refusals', () => {
    expect(strictestOf([refuse(5), refuse(900), refuse(60)])).toMatchObject({
      retryAfterSeconds: 900,
    });
  });

  it('reports the tightest layer when everything is allowed', () => {
    expect(strictestOf([allow(99), allow(2), allow(40)])).toMatchObject({
      remaining: 2,
    });
  });

  it('allows when there is nothing to check', () => {
    expect(strictestOf([]).allowed).toBe(true);
  });
});
