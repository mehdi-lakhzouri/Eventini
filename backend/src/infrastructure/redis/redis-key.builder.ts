import { hashEmail, idSegment, ipSegment } from './redis-key.segments';

/**
 * Every Redis key this application writes — REDIS_KEYS_AND_LUA_SCRIPTS.md §3.
 *
 * ## Why nothing else may build a key
 *
 * A key concatenated by hand inside a service eventually diverges by one
 * character from the one built somewhere else, and then the counter being read
 * is not the counter being written. Nothing throws, nothing logs, and a rate
 * limit or a lockout simply stops applying. Routing every key through one file
 * makes that class of bug a compile-time impossibility rather than something a
 * reviewer has to notice.
 *
 * The builder is also where the email hash is applied, so a caller cannot put
 * a plaintext address into a key by forgetting a step.
 *
 * Convention: `{domain}:{subdomain}:{discriminant}`, lowercase, `:` as the
 * separator, no spaces and no accented characters.
 */
export const redisKeys = {
  rateLimit: {
    globalIp: (ip: string | null): string => `rl:global_ip:${ipSegment(ip)}`,
    globalUser: (userId: string): string =>
      `rl:global_user:${idSegment(userId)}`,
    globalOrganization: (organizationId: string): string =>
      `rl:global_org:${idSegment(organizationId)}`,

    loginIpEmail: (ip: string | null, email: string): string =>
      `rl:login_ip_email:${ipSegment(ip)}:${hashEmail(email)}`,
    loginIp: (ip: string | null): string => `rl:login_ip:${ipSegment(ip)}`,

    mfaVerify: (challengeId: string): string =>
      `rl:mfa_verify:${idSegment(challengeId)}`,
    refresh: (sessionId: string): string =>
      `rl:refresh:${idSegment(sessionId)}`,

    passwordResetEmail: (email: string): string =>
      `rl:pwd_reset_email:${hashEmail(email)}`,
    passwordResetIp: (ip: string | null): string =>
      `rl:pwd_reset_ip:${ipSegment(ip)}`,

    /**
     * L'acceptation d'invitation, par IP — EVT-043.
     *
     * Par IP et non par jeton : limiter par jeton ne freinerait rien, puisque
     * un attaquant qui force en essaie précisément un nouveau à chaque
     * tentative. C'est l'origine des tentatives qui est la dimension utile.
     */
    invitationAcceptanceIp: (ip: string | null): string =>
      `rl:invite_accept_ip:${ipSegment(ip)}`,

    checkInDevice: (deviceId: string): string =>
      `rl:checkin_device:${idSegment(deviceId)}`,
    importOrganization: (organizationId: string): string =>
      `rl:import_org:${idSegment(organizationId)}`,
  },

  /**
   * The braces in the first two are a real Redis Cluster hash tag, not
   * placeholder notation: `lockout-register-failure.lua` takes the counter and
   * the lock as two keys and writes both, which Cluster only permits when they
   * hash to the same slot. Without the tag the script would be rejected the
   * day the deployment grows past one node — and it would be rejected on the
   * login path.
   *
   * `emailCounter` carries no tag because it is written alone, and it is
   * deliberately keyed on the email only: it is the detection counter of
   * ADR-0013 §5.2 and it must never lock anything.
   */
  lockout: {
    counter: (ip: string | null, email: string): string =>
      `lockout:{${ipSegment(ip)}:${hashEmail(email)}}`,
    lock: (ip: string | null, email: string): string =>
      `lockout:lock:{${ipSegment(ip)}:${hashEmail(email)}}`,
    emailCounter: (email: string): string =>
      `lockout:counter:${hashEmail(email)}`,
  },

  cache: {
    session: (sessionId: string): string => `session:${idSegment(sessionId)}`,
    membershipPermissions: (membershipId: string, version: number): string =>
      `perms:${idSegment(membershipId)}:v${String(version)}`,
    platformPermissions: (userId: string, version: number): string =>
      `perms:platform:${idSegment(userId)}:v${String(version)}`,
    permissionsVersion: (membershipId: string): string =>
      `permsver:${idSegment(membershipId)}`,
    organizationStatus: (organizationId: string): string =>
      `org:${idSegment(organizationId)}:status`,
    eventState: (eventId: string): string =>
      `event:${idSegment(eventId)}:state`,
  },

  security: {
    qrReplay: (publicReference: string, nonce: string): string =>
      `replay:qr:${idSegment(publicReference)}:${idSegment(nonce)}`,
    mfaChallenge: (challengeId: string): string =>
      `mfa:challenge:${idSegment(challengeId)}`,
    reauthentication: (sessionId: string): string =>
      `reauth:${idSegment(sessionId)}`,
    csrfContext: (contextId: string): string =>
      `csrf:ctx:${idSegment(contextId)}`,
    revokedSession: (sessionId: string): string =>
      `revoked:session:${idSegment(sessionId)}`,
  },

  idempotency: {
    shortCircuit: (
      organizationId: string,
      actorId: string,
      routeHash: string,
      key: string,
    ): string =>
      `idem:${idSegment(organizationId)}:${idSegment(actorId)}:${idSegment(routeHash)}:${idSegment(key)}`,
  },

  locks: {
    import: (organizationId: string): string =>
      `lock:import:${idSegment(organizationId)}`,
    export: (organizationId: string): string =>
      `lock:export:${idSegment(organizationId)}`,
    outboxPublisher: (): string => 'lock:outbox:publisher',
  },

  realtime: {
    presenceDevices: (eventId: string): string =>
      `presence:event:${idSegment(eventId)}:devices`,
    presenceCounters: (eventId: string): string =>
      `presence:event:${idSegment(eventId)}:counters`,
    sseConnections: (userId: string): string => `sse:conn:${idSegment(userId)}`,
    eventChannel: (eventId: string): string =>
      `pubsub:event:${idSegment(eventId)}`,
  },
} as const;
