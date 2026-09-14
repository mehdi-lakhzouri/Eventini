import { createHash } from 'node:crypto';

import { normalizeEmail } from '../../../infrastructure/database/normalize-email';

/**
 * How a participant is recognised — DATABASE_SCHEMA.md §7.1, sprint-10 EVT-054.
 *
 * Two derived columns, with deliberately different strengths:
 *
 * - `normalized_email` is a **key**. `ux_participants_org_email_active`
 *   makes it unique per organization, so two active participants of one
 *   client never share an address. Same definition as `users.normalized_email`,
 *   so `Ada@X.com` and `ada@x.com` are one person here exactly as they are at
 *   login.
 * - `dedup_fingerprint` is a **signal**. Two rows sharing it are a *probable*
 *   duplicate, surfaced to a human and never merged automatically: a wrong
 *   automatic merge destroys one person's registrations and history, and
 *   cannot be undone.
 */

/**
 * ASCII unit separator — a character no normalized field can contain, so text
 * shifting from one field into the next can never produce the same input.
 */
const FIELD_SEPARATOR = String.fromCharCode(0x1f);

export interface ParticipantIdentity {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
}

export function normalizeParticipantEmail(email: string | null): string | null {
  if (email === null) {
    return null;
  }

  const normalized = normalizeEmail(email);
  return normalized === '' ? null : normalized;
}

/**
 * A name reduced to what a human would call "the same name".
 *
 * NFKD then stripping combining marks folds `Hélène` onto `helene`; every run
 * of punctuation or whitespace collapses to one space, so `Jean-Pierre`,
 * `jean pierre` and ` Jean  Pierre ` agree. Letters and digits of every script
 * survive — `\p{L}` rather than `[a-z]`, or a name written in Arabic would
 * normalize to the empty string and every such participant would collide.
 */
export function normalizePersonName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Digits and a leading `+` — the only part of a phone number that identifies. */
export function normalizePhoneForMatching(phone: string | null): string {
  if (phone === null) {
    return '';
  }

  const digits = phone.replace(/[^\d]/g, '');
  return phone.trim().startsWith('+') ? `+${digits}` : digits;
}

/**
 * `SHA-256` of the normalized name, email and phone, hexadecimal.
 *
 * The two name parts are sorted before hashing: a first and last name swapped
 * is the single most common error in a spreadsheet import (EVT-055), and the
 * price — `Martin Paul` flagged against `Paul Martin` — is one false signal a
 * human dismisses, not a merge.
 *
 * Changing anything here changes every fingerprint, so a revision needs a
 * backfill of `participants.dedup_fingerprint` in the same migration.
 */
export function participantFingerprint(identity: ParticipantIdentity): string {
  const names = [
    normalizePersonName(identity.firstName),
    normalizePersonName(identity.lastName),
  ].sort();

  return createHash('sha256')
    .update(
      [
        ...names,
        normalizeParticipantEmail(identity.email) ?? '',
        normalizePhoneForMatching(identity.phone),
      ].join(FIELD_SEPARATOR),
      'utf8',
    )
    .digest('hex');
}
