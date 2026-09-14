import type {
  ParticipantChanges,
  ParticipantValues,
} from './participant.repository';

/**
 * Serialized size cap for `participants.metadata`.
 *
 * The column holds caller-defined fields with no GIN index (DATABASE_SCHEMA.md
 * §7.1), and the table is where personal data is supposed to be *minimized*.
 * A cap turns "custom fields" from an unbounded side channel for whole
 * profiles into what it is meant to be: a few tags.
 */
export const MAX_METADATA_BYTES = 8_000;

export function isMetadataWithinLimit(
  metadata: Record<string, unknown>,
): boolean {
  return (
    Buffer.byteLength(JSON.stringify(metadata), 'utf8') <= MAX_METADATA_BYTES
  );
}

/**
 * What is stored is what the caller meant, not what their form padded.
 *
 * Optional text that trims to nothing becomes `null`: an empty `job_title`
 * and an absent one are the same fact, and storing both would make every
 * "has a job title" filter need to know that.
 */
export function cleanOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const OPTIONAL_TEXT_FIELDS = [
  'email',
  'phone',
  'organizationName',
  'jobTitle',
  'externalReference',
] as const;

/** ISO 3166-1 alpha-2 is uppercase; `tn` and `TN` are one country. */
function cleanCountry(value: string | null): string | null {
  return cleanOptionalText(value)?.toUpperCase() ?? null;
}

export function cleanParticipantValues(
  values: ParticipantValues,
): ParticipantValues {
  return {
    ...values,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: cleanOptionalText(values.email),
    phone: cleanOptionalText(values.phone),
    organizationName: cleanOptionalText(values.organizationName),
    jobTitle: cleanOptionalText(values.jobTitle),
    country: cleanCountry(values.country),
    externalReference: cleanOptionalText(values.externalReference),
  };
}

export function cleanParticipantChanges(
  changes: ParticipantChanges,
): ParticipantChanges {
  const cleaned: ParticipantChanges = { ...changes };

  if (changes.firstName !== undefined) {
    cleaned.firstName = changes.firstName.trim();
  }
  if (changes.lastName !== undefined) {
    cleaned.lastName = changes.lastName.trim();
  }
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = changes[field];
    if (value !== undefined) {
      cleaned[field] = cleanOptionalText(value);
    }
  }
  if (changes.country !== undefined) {
    cleaned.country = cleanCountry(changes.country);
  }

  return cleaned;
}
