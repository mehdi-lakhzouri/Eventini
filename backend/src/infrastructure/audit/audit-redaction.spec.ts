import {
  AUDIT_REDACTION_MARKER,
  buildAuditDiff,
  redactAuditValues,
} from './audit-redaction';

describe('redactAuditValues', () => {
  it('replaces a sensitive value with the marker', () => {
    expect(redactAuditValues({ passwordHash: 'argon2id$v=19$...' })).toEqual({
      passwordHash: AUDIT_REDACTION_MARKER,
    });
  });

  /**
   * The rule this module exists for (§8.2). Dropping the key would make the
   * audit row say the password did not change — the opposite of the truth,
   * and exactly what someone covering their tracks would want it to say.
   */
  it('KEEPS the key rather than omitting it', () => {
    const redacted = redactAuditValues({
      passwordHash: 'secret',
      email: 'a@b.c',
    }) as Record<string, unknown>;

    expect(Object.keys(redacted).sort()).toEqual(['email', 'passwordHash']);
    expect(redacted).toHaveProperty('passwordHash');
  });

  it('records that a secret changed without disclosing either value', () => {
    const diff = buildAuditDiff(
      { passwordHash: 'old-hash' },
      { passwordHash: 'new-hash' },
    );

    const serialized = JSON.stringify(diff);
    expect(serialized).not.toContain('old-hash');
    expect(serialized).not.toContain('new-hash');
    // The change itself is still visible: both sides carry the key.
    expect(diff.previousValues).toHaveProperty('passwordHash');
    expect(diff.newValues).toHaveProperty('passwordHash');
  });

  it('leaves non-sensitive values intact, so the diff stays useful', () => {
    const input = { name: 'Summit', capacity: 400, status: 'ACTIVE' };

    expect(redactAuditValues(input)).toEqual(input);
  });

  it('redacts at any depth', () => {
    const redacted = redactAuditValues({
      credential: { nested: { refreshToken: 'rt_secret' } },
    });

    expect(JSON.stringify(redacted)).not.toContain('rt_secret');
  });

  it('redacts inside arrays', () => {
    const redacted = redactAuditValues({
      members: [{ email: 'a@b.c', mfaSecret: 'totp-seed' }],
    });

    expect(JSON.stringify(redacted)).not.toContain('totp-seed');
    expect(JSON.stringify(redacted)).toContain('a@b.c');
  });

  it('matches key names case-insensitively', () => {
    const redacted = redactAuditValues({
      PasswordHash: 'x',
      MFASECRET: 'y',
    }) as Record<string, unknown>;

    expect(redacted.PasswordHash).toBe(AUDIT_REDACTION_MARKER);
    expect(redacted.MFASECRET).toBe(AUDIT_REDACTION_MARKER);
  });

  it('terminates on a cyclic object instead of hanging an audit write', () => {
    const cyclic: Record<string, unknown> = { action: 'x' };
    cyclic.self = cyclic;

    expect(() => redactAuditValues(cyclic)).not.toThrow();
  });

  it('does not rewrite a Date into a plain object', () => {
    const when = new Date('2026-07-31T00:00:00.000Z');
    const redacted = redactAuditValues({ when }) as { when: unknown };

    expect(redacted.when).toBe(when);
  });

  it.each([
    'passwordHash',
    'refreshToken',
    'accessToken',
    'mfaSecret',
    'totpSecret',
    'recoveryCodes',
    'invitationToken',
    'passwordResetToken',
    'qrSignature',
    'privateKey',
  ])('redacts %s', (key) => {
    const redacted = redactAuditValues({ [key]: 'CANARY' }) as Record<
      string,
      unknown
    >;

    expect(redacted[key]).toBe(AUDIT_REDACTION_MARKER);
  });
});

describe('buildAuditDiff', () => {
  it('passes null through on either side', () => {
    expect(buildAuditDiff(null, { name: 'x' })).toEqual({
      previousValues: null,
      newValues: { name: 'x' },
    });
    expect(buildAuditDiff({ name: 'x' }, null)).toEqual({
      previousValues: { name: 'x' },
      newValues: null,
    });
  });

  it('treats undefined as absent, which a creation and a deletion both need', () => {
    expect(buildAuditDiff(undefined, undefined)).toEqual({
      previousValues: null,
      newValues: null,
    });
  });

  /**
   * Redacting only one side would leak the value while the row still looked
   * redacted — the worst of both outcomes.
   */
  it('redacts both sides with the same rules', () => {
    const diff = buildAuditDiff({ apiKey: 'old' }, { apiKey: 'new' }) as {
      previousValues: Record<string, unknown>;
      newValues: Record<string, unknown>;
    };

    expect(diff.previousValues.apiKey).toBe(AUDIT_REDACTION_MARKER);
    expect(diff.newValues.apiKey).toBe(AUDIT_REDACTION_MARKER);
  });

  it('uses the uppercase marker the schema doc specifies', () => {
    expect(AUDIT_REDACTION_MARKER).toBe('[REDACTED]');
  });
});
