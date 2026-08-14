#!/usr/bin/env node
/**
 * Writes a complete, valid `backend/.env` for local development.
 *
 * The environment validation refuses to start on a placeholder secret, which is
 * correct but would otherwise make first-run setup a chore of generating twelve
 * values by hand. This closes that gap: fail-closed stays principled without
 * being hostile.
 *
 * Generates real Ed25519 key pairs and real random secrets, all independent —
 * never one value reused across variables, because reuse is what cross rule 8
 * exists to refuse.
 *
 *     node scripts/generate-dev-env.mjs           # refuses to overwrite
 *     node scripts/generate-dev-env.mjs --force   # overwrites
 *
 * Development only. Deployed environments inject secrets from a secret manager;
 * this script must never be part of a deployment pipeline.
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..');
const examplePath = join(backendRoot, '.env.example');
const targetPath = join(backendRoot, '.env');

const force = process.argv.includes('--force');

if (!existsSync(examplePath)) {
  console.error(`\n  ${examplePath} not found.\n`);
  process.exit(1);
}

/** 32 random bytes, base64. Matches `openssl rand -base64 32`. */
const secret = () => randomBytes(32).toString('base64');

/** An Ed25519 key pair as base64-wrapped PEM (ADR-0005). */
function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  return {
    privateKey: Buffer.from(
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ).toString('base64'),
    publicKey: Buffer.from(
      publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64'),
  };
}

const accessTokenKeys = keyPair();
const qrSigningKeys = keyPair();

// Each entry gets its own generated value. Independence is the point.
const replacements = {
  ACCESS_TOKEN_PRIVATE_KEY: accessTokenKeys.privateKey,
  ACCESS_TOKEN_PUBLIC_KEY: accessTokenKeys.publicKey,
  QR_SIGNING_PRIVATE_KEY: qrSigningKeys.privateKey,
  QR_SIGNING_PUBLIC_KEY: qrSigningKeys.publicKey,
  REFRESH_TOKEN_HMAC_SECRET: secret(),
  CSRF_SECRET: secret(),
  MFA_ENCRYPTION_KEY: secret(),
  INVITATION_TOKEN_SECRET: secret(),
  PASSWORD_RESET_TOKEN_SECRET: secret(),
  COOKIE_SECRET: secret(),
  PASSWORD_PEPPER: secret(),
};

const rendered = readFileSync(examplePath, 'utf8')
  .split('\n')
  .map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (match === null) return line;

    const key = match[1];
    return key in replacements ? `${key}=${replacements[key]}` : line;
  })
  .join('\n');

// 'wx' fails if the file already exists, atomically. An existsSync() check
// followed by a write is a time-of-check-to-time-of-use race: the file can
// appear in between, and the guard that exists to avoid destroying secrets
// nobody can regenerate would be the thing that destroys them.
try {
  writeFileSync(targetPath, rendered, { mode: 0o600, flag: force ? 'w' : 'wx' });
} catch (error) {
  if (error?.code === 'EEXIST') {
    console.error(
      `\n  ${targetPath} already exists.\n` +
        '  Refusing to overwrite it — it may hold secrets you cannot regenerate.\n' +
        '  Pass --force if you are sure.\n',
    );
    process.exit(1);
  }

  throw error;
}

console.log(
  [
    '',
    `  Wrote ${targetPath}`,
    '',
    `  ${Object.keys(replacements).length} secrets generated, all independent.`,
    '  2 Ed25519 key pairs (access token signing, QR signing).',
    '',
    '  This file is gitignored. Do not commit it, and do not reuse these',
    '  values anywhere but your own machine.',
    '',
    '  PASSWORD_PEPPER note: in a real environment this is a critical backup',
    '  item — losing it makes every stored password unverifiable.',
    '',
  ].join('\n'),
);
