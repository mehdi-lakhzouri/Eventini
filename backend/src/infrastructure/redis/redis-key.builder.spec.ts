import { redisKeys } from './redis-key.builder';
import { hashEmail, idSegment, ipSegment } from './redis-key.segments';

describe('redis key builder', () => {
  const EMAIL = 'Admin@Eventini.test';

  describe('email hashing', () => {
    it('never puts the address itself in a key', () => {
      const keys = [
        redisKeys.rateLimit.loginIpEmail('203.0.113.10', EMAIL),
        redisKeys.rateLimit.passwordResetEmail(EMAIL),
        redisKeys.lockout.counter('203.0.113.10', EMAIL),
        redisKeys.lockout.lock('203.0.113.10', EMAIL),
        redisKeys.lockout.emailCounter(EMAIL),
      ];

      for (const key of keys) {
        expect(key).not.toContain('admin');
        expect(key).not.toContain('eventini.test');
        expect(key).not.toContain('@');
      }
    });

    it('produces 128 bits of hexadecimal', () => {
      expect(hashEmail(EMAIL)).toMatch(/^[0-9a-f]{32}$/);
    });

    /** Or a per-email limit is escaped by typing the address differently. */
    it('folds case and spacing to one counter', () => {
      expect(hashEmail('  ADMIN@EVENTINI.TEST ')).toBe(hashEmail(EMAIL));
    });

    it('separates two different addresses', () => {
      expect(hashEmail('a@eventini.test')).not.toBe(
        hashEmail('b@eventini.test'),
      );
    });
  });

  describe('address segments', () => {
    it('keeps IPv4 verbatim', () => {
      expect(ipSegment('203.0.113.10')).toBe('203.0.113.10');
    });

    /** Otherwise the separator inside the address rewrites the key shape. */
    it('rewrites the colons of an IPv6 address', () => {
      expect(ipSegment('2001:db8::1')).toBe('2001-db8--1');
    });

    it('counts an IPv4-mapped client under its IPv4 key', () => {
      expect(ipSegment('::ffff:203.0.113.10')).toBe(ipSegment('203.0.113.10'));
    });

    /** A missing address must still be counted, not exempted. */
    it.each([null, undefined, '   '])('buckets %p as unknown', (value) => {
      expect(ipSegment(value)).toBe('unknown');
    });

    it('strips separators out of an opaque identifier', () => {
      expect(idSegment('ses:01 ABC')).toBe('ses-01-abc');
    });
  });

  describe('the catalogue', () => {
    it.each([
      [
        'rl:global_ip:203.0.113.10',
        redisKeys.rateLimit.globalIp('203.0.113.10'),
      ],
      ['rl:global_user:usr_01', redisKeys.rateLimit.globalUser('usr_01')],
      [
        'rl:global_org:org_01',
        redisKeys.rateLimit.globalOrganization('org_01'),
      ],
      ['rl:login_ip:203.0.113.10', redisKeys.rateLimit.loginIp('203.0.113.10')],
      ['rl:mfa_verify:mfc_01', redisKeys.rateLimit.mfaVerify('mfc_01')],
      ['rl:refresh:ses_01', redisKeys.rateLimit.refresh('ses_01')],
      [
        'rl:pwd_reset_ip:203.0.113.10',
        redisKeys.rateLimit.passwordResetIp('203.0.113.10'),
      ],
      ['rl:checkin_device:dev_01', redisKeys.rateLimit.checkInDevice('dev_01')],
      [
        'rl:import_org:org_01',
        redisKeys.rateLimit.importOrganization('org_01'),
      ],
      ['session:ses_01', redisKeys.cache.session('ses_01')],
      ['perms:mbr_01:v3', redisKeys.cache.membershipPermissions('mbr_01', 3)],
      [
        'perms:platform:usr_01:v2',
        redisKeys.cache.platformPermissions('usr_01', 2),
      ],
      ['permsver:mbr_01', redisKeys.cache.permissionsVersion('mbr_01')],
      ['org:org_01:status', redisKeys.cache.organizationStatus('org_01')],
      ['event:evt_01:state', redisKeys.cache.eventState('evt_01')],
      ['replay:qr:pr_01:n_01', redisKeys.security.qrReplay('pr_01', 'n_01')],
      ['mfa:challenge:mfc_01', redisKeys.security.mfaChallenge('mfc_01')],
      ['reauth:ses_01', redisKeys.security.reauthentication('ses_01')],
      ['csrf:ctx:ctx_01', redisKeys.security.csrfContext('ctx_01')],
      ['revoked:session:ses_01', redisKeys.security.revokedSession('ses_01')],
      [
        'idem:org_01:usr_01:rh_01:k_01',
        redisKeys.idempotency.shortCircuit('org_01', 'usr_01', 'rh_01', 'k_01'),
      ],
      ['lock:import:org_01', redisKeys.locks.import('org_01')],
      ['lock:export:org_01', redisKeys.locks.export('org_01')],
      ['lock:outbox:publisher', redisKeys.locks.outboxPublisher()],
      [
        'presence:event:evt_01:devices',
        redisKeys.realtime.presenceDevices('evt_01'),
      ],
      [
        'presence:event:evt_01:counters',
        redisKeys.realtime.presenceCounters('evt_01'),
      ],
      ['sse:conn:usr_01', redisKeys.realtime.sseConnections('usr_01')],
      ['pubsub:event:evt_01', redisKeys.realtime.eventChannel('evt_01')],
    ])('builds %s', (expected, actual) => {
      expect(actual).toBe(expected);
    });

    it('keys the login window on the pair, not on the address alone', () => {
      const victim = redisKeys.rateLimit.loginIpEmail('198.51.100.20', EMAIL);
      const attacker = redisKeys.rateLimit.loginIpEmail('203.0.113.10', EMAIL);

      expect(victim).not.toBe(attacker);
    });
  });

  /**
   * `lockout-register-failure.lua` writes two keys in one call, which Redis
   * Cluster only allows when both hash to the same slot.
   */
  describe('the lockout hash tag', () => {
    it('pins the counter and the lock to one slot', () => {
      const counter = redisKeys.lockout.counter('203.0.113.10', EMAIL);
      const lock = redisKeys.lockout.lock('203.0.113.10', EMAIL);

      expect(hashTagOf(counter)).toBe(hashTagOf(lock));
      expect(hashTagOf(counter)).toBe(`203.0.113.10:${hashEmail(EMAIL)}`);
    });

    /**
     * ADR-0013 §5.2: this one is written alone and must never gate a login.
     * A hash tag would only be noise, and its absence marks it as the odd one.
     */
    it('leaves the detection counter untagged', () => {
      expect(redisKeys.lockout.emailCounter(EMAIL)).toBe(
        `lockout:counter:${hashEmail(EMAIL)}`,
      );
    });

    it('gives two addresses two different slots for the same account', () => {
      expect(
        hashTagOf(redisKeys.lockout.lock('198.51.100.20', EMAIL)),
      ).not.toBe(hashTagOf(redisKeys.lockout.lock('203.0.113.10', EMAIL)));
    });
  });
});

function hashTagOf(key: string): string {
  return key.slice(key.indexOf('{') + 1, key.indexOf('}'));
}
