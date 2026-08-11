#!/usr/bin/env node
/**
 * Builds the `.env` that CI's integration and e2e suites boot against.
 *
 * ## Why this exists rather than a block of `env:` keys in the workflow
 *
 * The application validates its whole environment at boot, and rule 9 of
 * `secret-hygiene.rule.ts` **rejects** the placeholders in `.env.example` by
 * design — "you shipped the example file" is exactly what it is there to
 * catch. So CI cannot simply copy that file, and it cannot list the variables
 * inline either: there are 121 of them, and a hand-maintained subset in YAML
 * drifts the first time someone adds a required one.
 *
 * Starting from `.env.example` and replacing only the secrets keeps the two in
 * step automatically. A new variable added to the example file is picked up on
 * the next run with no workflow change.
 *
 * ## The generated values are real, not placeholders
 *
 * Rule 7 wants 32 bytes, rule 8 wants every secret distinct, and the signing
 * keys have to survive `createPrivateKey`. Fabricating something that merely
 * passes validation would mean CI exercised a configuration no deployment
 * could ever have. These are genuine Ed25519 keypairs and genuine random
 * secrets, generated fresh per run and never leaving the runner.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backendRoot = resolve(import.meta.dirname, '..', '..');
const source = resolve(backendRoot, '.env.example');

/**
 * `.env` on a CI runner, but overridable — running this on a developer
 * machine would otherwise overwrite the real one, and a script whose only
 * safe test is "run it and see" is a script nobody tests.
 */
const target = process.env.CI_ENV_OUTPUT
  ? resolve(process.env.CI_ENV_OUTPUT)
  : resolve(backendRoot, '.env');

/** 32 bytes, base64 — the shape rule 7 measures after decoding. */
const secret = () => randomBytes(32).toString('base64');

/** Base64-wrapped PEM, which is what `toPem` in `signing-keys.ts` accepts. */
function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const encode = (key, type) =>
    Buffer.from(key.export({ type, format: 'pem' })).toString('base64');

  return {
    private: encode(privateKey, 'pkcs8'),
    public: encode(publicKey, 'spki'),
  };
}

const access = keyPair();
const qr = keyPair();

/**
 * Every secret gets its own value. Reusing one would pass rules 7 and 9 and
 * fail rule 8 — which is the point of rule 8, and worth having CI prove rather
 * than assume.
 */
const replacements = new Map(
  Object.entries({
    REFRESH_TOKEN_HMAC_SECRET: secret(),
    CSRF_SECRET: secret(),
    MFA_ENCRYPTION_KEY: secret(),
    INVITATION_TOKEN_SECRET: secret(),
    PASSWORD_RESET_TOKEN_SECRET: secret(),
    PASSWORD_PEPPER: secret(),
    COOKIE_SECRET: secret(),
    ACCESS_TOKEN_PRIVATE_KEY: access.private,
    ACCESS_TOKEN_PUBLIC_KEY: access.public,
    QR_SIGNING_PRIVATE_KEY: qr.private,
    QR_SIGNING_PUBLIC_KEY: qr.public,

    // The service containers, not the docker-compose ports the example file
    // documents for a developer machine.
    DATABASE_URL:
      process.env.CI_DATABASE_URL ??
      'postgresql://eventini:eventini_ci@localhost:5432/eventini_test?schema=public',
    REDIS_URL: process.env.CI_REDIS_URL ?? 'redis://localhost:6379/0',

    // `test`, not `development`: production refuses to start without
    // `COOKIE_SECURE=true` and https origins, and the runner serves plain http.
    NODE_ENV: 'test',
  }),
);

const rewritten = readFileSync(source, 'utf8')
  .split('\n')
  .map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    const replacement = match ? replacements.get(match[1]) : undefined;

    return replacement === undefined ? line : `${match[1]}=${replacement}`;
  })
  .join('\n');

// Guards the guard: a rename in `.env.example` would otherwise leave a
// placeholder in place and surface as a confusing rule-9 failure at boot.
const missing = [...replacements.keys()].filter(
  (key) => !new RegExp(`^${key}=`, 'm').test(rewritten),
);

if (missing.length > 0) {
  console.error(
    `.env.example has no line for: ${missing.join(', ')}. ` +
      'Add it there, or drop it from this script.',
  );
  process.exit(1);
}

writeFileSync(target, rewritten, 'utf8');
console.log(
  `wrote ${target} from .env.example with ${String(replacements.size)} generated values`,
);
