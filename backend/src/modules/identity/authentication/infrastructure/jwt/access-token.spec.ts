import { createSecretKey, generateKeyPairSync } from 'node:crypto';

import type { AccessTokenClaims } from './access-token.claims';
import { PAYLOAD_CLAIMS } from './access-token.claims';
import { AccessTokenError } from './access-token.errors';
import { AccessTokenSigner } from './access-token.signer';
import { AccessTokenVerifier } from './access-token.verifier';
import { loadJose } from './jose';
import { SigningKeySet } from './signing-keys';

const ISSUER = 'https://api.eventini.test';
const SETTINGS = {
  issuer: ISSUER,
  audienceWeb: 'eventini-web',
  audienceScanner: 'eventini-scanner',
  clockToleranceSeconds: 30,
};

function pem(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');

  return {
    privateKey: pair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicKey: pair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
  };
}

const CURRENT = pem();
const PREVIOUS = pem();

const CLAIMS: AccessTokenClaims = {
  userId: 'usr_1',
  sessionId: 'ses_1',
  organizationId: 'org_1',
  membershipId: 'mbr_1',
  userVersion: 3,
  clientType: 'WEB',
  authLevel: 'MFA',
};

function keySet(
  overrides: Partial<ConstructorParameters<typeof SigningKeySet>[0]> = {},
) {
  return new SigningKeySet({
    privateKey: CURRENT.privateKey,
    publicKey: CURRENT.publicKey,
    keyId: 'ak_2026_08',
    ...overrides,
  });
}

const keys = keySet({
  previousPublicKey: PREVIOUS.publicKey,
  previousKeyId: 'ak_2026_07',
});
const signer = new AccessTokenSigner(keys, SETTINGS);
const verifier = new AccessTokenVerifier(keys, SETTINGS);

async function decode(token: string) {
  const { decodeJwt, decodeProtectedHeader } = await loadJose();

  return { header: decodeProtectedHeader(token), payload: decodeJwt(token) };
}

describe('issuing an access token', () => {
  it('signs EdDSA and names the active key', async () => {
    const { token } = await signer.issue(CLAIMS, 600);
    const { header } = await decode(token);

    expect(header).toEqual({ alg: 'EdDSA', kid: 'ak_2026_08', typ: 'JWT' });
  });

  it('carries exactly the claims ADR-0005 lists', async () => {
    const { token } = await signer.issue(CLAIMS, 600);
    const { payload } = await decode(token);

    expect(Object.keys(payload).sort()).toEqual(
      [...PAYLOAD_CLAIMS, 'iat', 'exp', 'iss', 'aud'].sort(),
    );
    expect(payload).toMatchObject({
      sub: 'usr_1',
      sid: 'ses_1',
      org: 'org_1',
      mbr: 'mbr_1',
      ver: 3,
      ct: 'WEB',
      al: 'MFA',
      iss: ISSUER,
      aud: 'eventini-web',
    });
  });

  it('keeps null tenant claims for a platform session', async () => {
    const { token } = await signer.issue(
      { ...CLAIMS, organizationId: null, membershipId: null },
      600,
    );
    const { payload } = await decode(token);

    expect(payload['org']).toBeNull();
    expect(payload['mbr']).toBeNull();
  });

  it('addresses a scanner token to the scanner audience', async () => {
    const { token } = await signer.issue(
      { ...CLAIMS, clientType: 'MOBILE_SCANNER' },
      900,
    );
    const { payload } = await decode(token);

    expect(payload['aud']).toBe('eventini-scanner');
  });

  it('reports the expiry it signed', async () => {
    const { token, expiresAt } = await signer.issue(CLAIMS, 600);
    const { payload } = await decode(token);

    expect(payload['exp']).toBe(Math.floor(expiresAt.getTime() / 1000));
  });
});

describe('verifying an access token', () => {
  it('returns the parsed claims', async () => {
    const { token } = await signer.issue(CLAIMS, 600);

    await expect(verifier.verify(token, 'WEB')).resolves.toMatchObject({
      ...CLAIMS,
      keyId: 'ak_2026_08',
    });
  });

  it('accepts a token signed with the previous key during the overlap', async () => {
    const previousSigner = new AccessTokenSigner(
      keySet({
        privateKey: PREVIOUS.privateKey,
        publicKey: PREVIOUS.publicKey,
        keyId: 'ak_2026_07',
      }),
      SETTINGS,
    );
    const { token } = await previousSigner.issue(CLAIMS, 600);

    await expect(verifier.verify(token, 'WEB')).resolves.toMatchObject({
      keyId: 'ak_2026_07',
    });
  });
});

/** The attacks EVT-022 lists as mandatory. */
describe('rejects forged and mismatched tokens', () => {
  async function rejection(
    token: string,
    clientType: 'WEB' | 'MOBILE_SCANNER' = 'WEB',
  ): Promise<string> {
    try {
      await verifier.verify(token, clientType);
    } catch (error) {
      expect(error).toBeInstanceOf(AccessTokenError);

      return (error as AccessTokenError).rejection;
    }

    throw new Error('the token was accepted');
  }

  it('refuses alg: none', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'ak_2026_08' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'usr_1', iss: ISSUER, aud: 'eventini-web' }),
    ).toString('base64url');

    await expect(rejection(`${header}.${payload}.`)).resolves.toBe(
      'BAD_SIGNATURE',
    );
  });

  /**
   * Algorithm confusion. The Ed25519 public key is not secret, so if the
   * verifier trusted the header's `alg` it would happily treat that public key
   * as an HMAC secret and accept anything the attacker signed with it.
   */
  it('refuses HS256 signed with the public key as the secret', async () => {
    const { SignJWT } = await loadJose();
    const publicBytes = Buffer.from(CURRENT.publicKey);

    const forged = await new SignJWT({
      sub: 'usr_1',
      sid: 'ses_1',
      org: 'org_1',
      mbr: 'mbr_1',
      ver: 3,
      ct: 'WEB',
      al: 'MFA',
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'ak_2026_08', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .setIssuer(ISSUER)
      .setAudience('eventini-web')
      .sign(createSecretKey(publicBytes));

    await expect(rejection(forged)).resolves.toBe('BAD_SIGNATURE');
  });

  it('refuses a kid outside the verification set', async () => {
    const strangerSigner = new AccessTokenSigner(
      keySet({ keyId: 'ak_rotated_out' }),
      SETTINGS,
    );
    const { token } = await strangerSigner.issue(CLAIMS, 600);

    await expect(rejection(token)).resolves.toBe('UNKNOWN_KEY');
  });

  /** Emergency revocation: the key leaves the set and its tokens die at once. */
  it('refuses a token whose key has just been rotated out', async () => {
    const narrowed = new AccessTokenVerifier(keySet(), SETTINGS);
    const previousSigner = new AccessTokenSigner(
      keySet({
        privateKey: PREVIOUS.privateKey,
        publicKey: PREVIOUS.publicKey,
        keyId: 'ak_2026_07',
      }),
      SETTINGS,
    );
    const { token } = await previousSigner.issue(CLAIMS, 600);

    await expect(narrowed.verify(token, 'WEB')).rejects.toThrow(
      AccessTokenError,
    );
  });

  it('refuses a signature made by a key that is not the named one', async () => {
    const impostor = pem();
    const impostorSigner = new AccessTokenSigner(
      keySet({
        privateKey: impostor.privateKey,
        publicKey: impostor.publicKey,
        keyId: 'ak_2026_08',
      }),
      SETTINGS,
    );
    const { token } = await impostorSigner.issue(CLAIMS, 600);

    await expect(rejection(token)).resolves.toBe('BAD_SIGNATURE');
  });

  it('refuses a wrong issuer', async () => {
    const other = new AccessTokenSigner(keys, {
      ...SETTINGS,
      issuer: 'https://evil.example',
    });
    const { token } = await other.issue(CLAIMS, 600);

    await expect(rejection(token)).resolves.toBe('BAD_ISSUER');
  });

  /** A scanner token must not be accepted by the web API, or the reverse. */
  it('refuses a token addressed to the other audience', async () => {
    const { token } = await signer.issue(
      { ...CLAIMS, clientType: 'MOBILE_SCANNER' },
      900,
    );

    await expect(rejection(token, 'WEB')).resolves.toBe('BAD_AUDIENCE');
  });

  it('refuses a token expired beyond the clock tolerance', async () => {
    const { token } = await signer.issue(CLAIMS, -31);

    await expect(rejection(token)).resolves.toBe('EXPIRED');
  });

  it('accepts one expired inside the clock tolerance', async () => {
    const { token } = await signer.issue(CLAIMS, -5);

    await expect(verifier.verify(token, 'WEB')).resolves.toMatchObject({
      sessionId: 'ses_1',
    });
  });

  it.each([
    ['no token at all', ''],
    ['not a JWT', 'not-a-token'],
    ['a truncated token', 'a.b'],
  ])('refuses %s', async (_label, token) => {
    await expect(verifier.verify(token, 'WEB')).rejects.toThrow(
      AccessTokenError,
    );
  });

  it.each(['sub', 'sid', 'ver', 'ct', 'al'])(
    'refuses a validly signed token missing %s',
    async (claim) => {
      const { SignJWT } = await loadJose();
      const payload: Record<string, unknown> = {
        sub: 'usr_1',
        sid: 'ses_1',
        org: null,
        mbr: null,
        ver: 3,
        ct: 'WEB',
        al: 'MFA',
      };
      delete payload[claim];

      const token = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'EdDSA', kid: 'ak_2026_08', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .setIssuer(ISSUER)
        .setAudience('eventini-web')
        .sign(keys.signingKey());

      await expect(rejection(token)).resolves.toBe('BAD_CLAIMS');
    },
  );

  it('refuses an unknown value for a closed claim', async () => {
    const { SignJWT } = await loadJose();
    const token = await new SignJWT({
      sub: 'usr_1',
      sid: 'ses_1',
      org: null,
      mbr: null,
      ver: 3,
      ct: 'WEB',
      al: 'GOD_MODE',
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'ak_2026_08', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .setIssuer(ISSUER)
      .setAudience('eventini-web')
      .sign(keys.signingKey());

    await expect(rejection(token)).resolves.toBe('BAD_CLAIMS');
  });
});

describe('SigningKeySet', () => {
  it('verifies with both keys and signs with one', () => {
    expect([...keys.verificationKeyIds].sort()).toEqual([
      'ak_2026_07',
      'ak_2026_08',
    ]);
    expect(keys.activeKeyId).toBe('ak_2026_08');
  });

  it('holds only the active key when no previous one is configured', () => {
    expect(keySet().verificationKeyIds).toEqual(['ak_2026_08']);
  });

  it('accepts base64-wrapped PEM', () => {
    const wrapped = keySet({
      privateKey: Buffer.from(CURRENT.privateKey).toString('base64'),
      publicKey: Buffer.from(CURRENT.publicKey).toString('base64'),
    });

    expect(wrapped.activeKeyId).toBe('ak_2026_08');
  });

  /**
   * The misconfiguration that silently cancels a rotation: both `kid`s equal,
   * so the map holds one entry and every token signed with the old key is
   * refused the moment the new one is deployed.
   */
  it('refuses a previous kid equal to the active one', () => {
    expect(() =>
      keySet({
        previousPublicKey: PREVIOUS.publicKey,
        previousKeyId: 'ak_2026_08',
      }),
    ).toThrow(/equals ACCESS_TOKEN_KEY_ID/);
  });

  it('refuses an unknown or absent kid', () => {
    expect(() => keys.verificationKey('ak_nope')).toThrow(AccessTokenError);
    expect(() => keys.verificationKey(undefined)).toThrow(AccessTokenError);
  });
});
