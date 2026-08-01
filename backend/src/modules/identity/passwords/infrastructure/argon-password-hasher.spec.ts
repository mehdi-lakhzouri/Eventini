import { randomBytes } from 'node:crypto';

import { ArgonPasswordHasher } from './argon-password-hasher';
import { encodedHashLength, type Argon2Settings } from './argon2-profile';

const PROFILE: Argon2Settings = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  pepper: randomBytes(32).toString('base64'),
};

const PASSWORD = 'correct horse battery staple';

describe('ArgonPasswordHasher', () => {
  const hasher = new ArgonPasswordHasher(PROFILE);

  it('reports the profile version written to password_version', () => {
    expect(hasher.version).toBe(1);
  });

  it('produces an argon2id digest carrying the effective parameters', async () => {
    const digest = await hasher.hash(PASSWORD);

    // 0.45.1 emits m,p,t — not the m,t,p order the ADR's example shows.
    expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(encodedHashLength(digest)).toBe(32);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([
      hasher.hash(PASSWORD),
      hasher.hash(PASSWORD),
    ]);

    expect(first).not.toBe(second);
  });

  it('accepts the right password', async () => {
    const digest = await hasher.hash(PASSWORD);

    await expect(hasher.verify(digest, PASSWORD)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('rejects the wrong password', async () => {
    const digest = await hasher.hash(PASSWORD);

    await expect(hasher.verify(digest, 'wrong password here')).resolves.toEqual(
      { valid: false, needsRehash: false },
    );
  });

  it('keeps whitespace significant', async () => {
    const digest = await hasher.hash(` ${PASSWORD} `);

    await expect(hasher.verify(digest, PASSWORD)).resolves.toMatchObject({
      valid: false,
    });
  });

  describe('the pepper', () => {
    it('makes a digest unverifiable with a different pepper', async () => {
      const digest = await hasher.hash(PASSWORD);
      const other = new ArgonPasswordHasher({
        ...PROFILE,
        pepper: randomBytes(32).toString('base64'),
      });

      await expect(other.verify(digest, PASSWORD)).resolves.toMatchObject({
        valid: false,
      });
    });

    it('is absent from the digest', async () => {
      const digest = await hasher.hash(PASSWORD);
      const pepper = Buffer.from(PROFILE.pepper, 'base64');

      expect(digest).not.toContain(PROFILE.pepper);
      expect(digest).not.toContain(pepper.toString('hex'));
    });
  });

  describe('rehash on parameter drift', () => {
    it.each([
      ['memory cost', { memoryCost: 47_104 }],
      ['time cost', { timeCost: 3 }],
      ['parallelism', { parallelism: 2 }],
      ['hash length', { hashLength: 64 }],
    ])('flags a digest weaker than the current %s', async (_label, change) => {
      const legacy = new ArgonPasswordHasher({ ...PROFILE, ...change });
      const stale = await new ArgonPasswordHasher(PROFILE).hash(PASSWORD);

      await expect(legacy.verify(stale, PASSWORD)).resolves.toEqual({
        valid: true,
        needsRehash: true,
      });
    });

    it('does not flag a digest at the current profile', async () => {
      const digest = await hasher.hash(PASSWORD);

      await expect(hasher.verify(digest, PASSWORD)).resolves.toMatchObject({
        needsRehash: false,
      });
    });

    it('never flags a rehash for a password that did not verify', async () => {
      const weak = new ArgonPasswordHasher({ ...PROFILE, timeCost: 1 });
      const stale = await weak.hash(PASSWORD);

      await expect(
        hasher.verify(stale, 'wrong password here'),
      ).resolves.toEqual({ valid: false, needsRehash: false });
    });

    it('produces a fresh digest that no longer needs rehashing', async () => {
      const weak = new ArgonPasswordHasher({ ...PROFILE, timeCost: 1 });
      const stale = await weak.hash(PASSWORD);

      expect((await hasher.verify(stale, PASSWORD)).needsRehash).toBe(true);

      const upgraded = await hasher.hash(PASSWORD);

      expect((await hasher.verify(upgraded, PASSWORD)).needsRehash).toBe(false);
    });
  });

  it.each([
    ['not a hash at all', 'nonsense'],
    ['an empty string', ''],
    ['a truncated digest', '$argon2id$v=19$m=19456,p=1,t=2$'],
  ])('treats %s as invalid rather than throwing', async (_label, digest) => {
    await expect(hasher.verify(digest, PASSWORD)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  describe('verifyDecoy', () => {
    it('never throws and never reports success', async () => {
      await expect(hasher.verifyDecoy(PASSWORD)).resolves.toBeUndefined();
    });

    it('costs about as much as a real failed verification', async () => {
      const digest = await hasher.hash(PASSWORD);
      await hasher.verifyDecoy('warm up the decoy');

      const real = await time(() => hasher.verify(digest, 'wrong password'));
      const decoy = await time(() => hasher.verifyDecoy('wrong password'));

      // Generous: this guards against skipping the work entirely, which is an
      // order of magnitude, not against normal scheduling jitter.
      expect(decoy).toBeGreaterThan(real / 4);
      expect(decoy).toBeLessThan(real * 4);
    });
  });

  it('verifies within the 150 ms CI budget', async () => {
    const digest = await hasher.hash(PASSWORD);

    expect(await time(() => hasher.verify(digest, PASSWORD))).toBeLessThan(150);
  });
});

async function time(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();

  return performance.now() - started;
}
