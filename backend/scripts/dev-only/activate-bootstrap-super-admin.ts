/**
 * Dev-only: finishes activating the PENDING bootstrap SUPER_ADMIN created by
 * `prisma/seed/04-bootstrap-super-admin.seed.ts`.
 *
 * That seed deliberately stops after creating the account PENDING with no
 * credential: EVT-021 (email verification token issuance + delivery) is not
 * implemented yet, so there is currently no API path that can finish
 * activation (password-reset-requests only accepts `status = ACTIVE`, and MFA
 * enrolment requires an authenticated session the account cannot obtain).
 * This script performs the same writes a human would via the normal flow —
 * set a password, enrol TOTP, activate — directly against the database, so
 * local development is not blocked on the missing feature.
 *
 * Refuses to run when NODE_ENV=production. Never introduces a seeded
 * password: the password is supplied by the operator and never written to
 * this file or to git.
 *
 * Prints a QR code for the authenticator app. The secret, the URI and the QR
 * are equivalent to the second factor: they stay in the terminal that ran the
 * script and belong nowhere else.
 *
 * Usage (from backend/), password through the environment rather than argv so
 * it does not appear in the process list:
 *
 *   BOOTSTRAP_SUPER_ADMIN_PASSWORD='a passphrase of 12+ chars'  *     npx ts-node scripts/dev-only/activate-bootstrap-super-admin.ts
 *
 *   # a different account than BOOTSTRAP_SUPER_ADMIN_EMAIL
 *   ... --email admin@eventini.local
 *
 *   # reprovision an already-activated account: new password, new TOTP
 *   # secret, new recovery codes; the previous ones are destroyed
 *   ... --force
 */
import { config as loadDotenvFile } from 'dotenv';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error(
    'This script is dev-only and refuses to run with NODE_ENV=production.',
  );
}

loadDotenvFile({ path: '.env' });

import { PrismaPg } from '@prisma/adapter-pg';
import { toString as renderQrCode } from 'qrcode';

import {
  ID_PREFIXES,
  newId,
} from '../../src/infrastructure/database/identifiers';
import { normalizeEmail } from '../../src/infrastructure/database/normalize-email';
import { PrismaClient } from '../../src/infrastructure/database/prisma/generated/client';
import { getValidatedEnv } from '../../src/config/validated-env';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../../src/modules/identity/mfa/domain/recovery-codes';
import {
  generateTotpSecret,
  totpUri,
} from '../../src/modules/identity/mfa/domain/totp';
import { MfaSecretCipher } from '../../src/modules/identity/mfa/infrastructure/mfa-secret.cipher';
import { assertPasswordAllowed } from '../../src/modules/identity/passwords/domain/password.policy';
import { ArgonPasswordHasher } from '../../src/modules/identity/passwords/infrastructure/argon-password-hasher';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const env = getValidatedEnv();

  const email = readArg('email') ?? env.BOOTSTRAP_SUPER_ADMIN_EMAIL;

  /*
    🔴 La variable d'environnement est préférée à `--password`.

    Un argument de ligne de commande est visible dans la liste des processus —
    `ps` sous Unix, le gestionnaire des tâches sous Windows — pour **tout autre
    utilisateur de la machine**, pendant toute la durée du hachage Argon2id.
    Il atterrit aussi dans l'historique du shell, où il reste.

    L'environnement du processus est lisible par son propriétaire et par root,
    donc ce n'est pas un secret gardé : c'est simplement une exposition plus
    étroite. `--password` reste accepté parce qu'il est pratique et que le
    script est réservé au développement local, mais il n'est plus le chemin
    recommandé.
  */
  const password =
    process.env['BOOTSTRAP_SUPER_ADMIN_PASSWORD'] ?? readArg('password');
  const force = process.argv.includes('--force');

  if (!email) {
    throw new Error(
      'No --email given and BOOTSTRAP_SUPER_ADMIN_EMAIL is not set.',
    );
  }

  if (!password) {
    throw new Error(
      'No password supplied. Prefer BOOTSTRAP_SUPER_ADMIN_PASSWORD in the ' +
        'environment; --password "..." also works but is visible in the ' +
        'process list.',
    );
  }

  const normalizedPassword = assertPasswordAllowed(password, {
    minLength: env.PASSWORD_MIN_LENGTH,
    maxLength: env.PASSWORD_MAX_LENGTH,
  });

  const hasher = new ArgonPasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
    hashLength: env.ARGON2_HASH_LENGTH,
    pepper: env.PASSWORD_PEPPER,
  });
  const passwordHash = await hasher.hash(normalizedPassword);

  const cipher = new MfaSecretCipher(env.MFA_ENCRYPTION_KEY);
  const totpSecret = generateTotpSecret();
  const encryptedSecret = cipher.encrypt(totpSecret);
  const uri = totpUri({
    secret: totpSecret,
    accountName: email,
    issuer: 'Eventini',
    settings: {
      digits: env.TOTP_DIGITS,
      periodSeconds: env.TOTP_PERIOD_SECONDS,
      driftWindows: env.TOTP_DRIFT_WINDOWS,
    },
  });

  const recoveryCodes = generateRecoveryCodes(env.RECOVERY_CODE_COUNT);
  const codeHashes = recoveryCodes.map((code) => hashRecoveryCode(code));

  const databaseUrl = env.DATABASE_URL;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const normalizedEmail = normalizeEmail(email);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { normalizedEmail, deletedAt: null },
        select: { id: true, status: true },
      });

      if (user === null) {
        throw new Error(
          `No user found for ${email}. Run "npm run db:seed" first.`,
        );
      }

      /*
        Sans `--force`, seul le compte inerte issu du seed est touché : c'est
        ce qui empêche le script de réinitialiser par mégarde le mot de passe
        d'un compte réellement utilisé.
      */
      if (user.status !== 'PENDING' && !force) {
        throw new Error(
          `User status is ${user.status}, not PENDING — this script only ` +
            'activates the inert bootstrap account. Pass --force to ' +
            'reprovision an already-activated one.',
        );
      }

      const grant = await tx.platformRoleAssignment.findFirst({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          role: { code: 'SUPER_ADMIN' },
        },
        select: { id: true },
      });

      if (grant === null) {
        throw new Error('This user does not hold an ACTIVE SUPER_ADMIN grant.');
      }

      const existingCredential = await tx.userCredential.findUnique({
        where: { userId: user.id },
        select: { userId: true },
      });

      /*
        `--force` reprovisionne un compte déjà activé : mot de passe, secret
        TOTP et codes de récupération sont régénérés, les anciens détruits.

        Le cas qui l'a rendu nécessaire : le secret affiché une fois est
        irrécupérable, donc un QR manqué — terminal fermé, capture perdue,
        secret ayant transité par un canal qu'on regrette — laissait le compte
        inutilisable **et** inréparable, puisque le script refusait de
        recommencer. La seule issue était de reconstruire toute la base.

        Refuse en dehors du développement par la garde en tête de fichier.
      */
      if (existingCredential !== null && !force) {
        throw new Error(
          'A credential already exists for this user. Pass --force to ' +
            'regenerate the password, the TOTP secret and the recovery codes.',
        );
      }

      if (existingCredential === null) {
        await tx.userCredential.create({
          data: { id: newId(ID_PREFIXES.user), userId: user.id, passwordHash },
        });
      } else {
        await tx.userCredential.update({
          where: { userId: user.id },
          data: { passwordHash },
        });
      }

      /*
        Les anciens facteurs partent avant que le nouveau n'arrive.

        Les codes de récupération d'abord : ils référencent la méthode MFA, et
        supprimer la méthode en premier heurterait la clé étrangère. INV-11
        n'est pas en cause ici — il se déclenche sur l'activation de
        l'utilisateur et sur l'octroi du rôle, pas sur la suppression d'une
        méthode d'un compte déjà actif, et la nouvelle méthode est créée dans
        la même transaction.
      */
      if (force) {
        const previous = await tx.mfaMethod.findMany({
          where: { userId: user.id },
          select: { id: true },
        });

        if (previous.length > 0) {
          const ids = previous.map((method) => method.id);

          await tx.mfaRecoveryCode.deleteMany({
            where: { mfaMethodId: { in: ids } },
          });
          await tx.mfaMethod.deleteMany({ where: { id: { in: ids } } });
        }
      }

      const methodId = newId(ID_PREFIXES.user);

      // Must be committed before the user row flips to ACTIVE below: the
      // INV-11 trigger on `users` checks for an ACTIVE mfa_methods row at
      // that moment.
      await tx.mfaMethod.create({
        data: {
          id: methodId,
          userId: user.id,
          type: 'TOTP',
          status: 'ACTIVE',
          encryptedSecret,
          verifiedAt: now,
          enabledAt: now,
        },
      });

      await tx.mfaRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({
          id: newId(ID_PREFIXES.user),
          mfaMethodId: methodId,
          codeHash,
          createdAt: now,
        })),
      });

      await tx.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerifiedAt: now },
      });
    });
  } finally {
    await prisma.$disconnect();
  }

  /*
    Le QR à scanner depuis l'application d'authentification.

    `errorCorrectionLevel: 'M'` plutôt que le défaut : un QR affiché en
    caractères de terminal se lit à travers un écran, souvent de biais et avec
    des cellules non carrées selon la police. Le niveau moyen tolère ~15 % de
    dégradation, ce qui suffit à absorber cela sans allonger démesurément le
    code.

    `small: true` utilise les demi-blocs Unicode : sans lui, le QR fait le
    double de hauteur et ne tient pas dans un terminal ordinaire — donc il
    défile, et un QR coupé en deux ne se scanne pas.
  */
  const qr = await renderQrCode(uri, {
    type: 'terminal',
    small: true,
    errorCorrectionLevel: 'M',
  });

  console.log('Bootstrap SUPER_ADMIN activated.');
  console.log('');
  console.log(`  email             ${email}`);
  console.log('  password          (as supplied on the command line)');
  console.log('');
  console.log('  Scan this with your authenticator app:');
  console.log('');
  console.log(qr);
  console.log(`  TOTP secret       ${totpSecret}`);
  console.log('  (type it by hand if the camera cannot read the code)');
  console.log(`  TOTP otpauth URI  ${uri}`);
  console.log('');
  console.log('  recovery codes    (store these now, shown only once)');
  for (const code of recoveryCodes) {
    console.log(`    ${code}`);
  }
  console.log('');
  console.log(
    '  🔴 The secret, the URI and the QR above are equivalent to the second',
  );
  console.log(
    '     factor itself. They stay in this terminal scrollback — clear it,',
  );
  console.log('     and never paste them into an issue or a chat.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
