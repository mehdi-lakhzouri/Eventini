import {
  normalizeParticipantEmail,
  normalizePersonName,
  normalizePhoneForMatching,
  participantFingerprint,
} from './participant-identity';

describe('participant identity', () => {
  const ada = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+21620123456',
  };

  describe('normalizeParticipantEmail', () => {
    it('shares the users.normalized_email definition', () => {
      expect(normalizeParticipantEmail('  Ada@Example.COM ')).toBe(
        'ada@example.com',
      );
    });

    it('keeps an absent email absent rather than empty', () => {
      expect(normalizeParticipantEmail(null)).toBeNull();
      expect(normalizeParticipantEmail('   ')).toBeNull();
    });
  });

  describe('normalizePersonName', () => {
    it.each([
      ['Hélène', 'helene'],
      ['Jean-Pierre', 'jean pierre'],
      ['  Jean   Pierre ', 'jean pierre'],
      ["O'Connor", 'o connor'],
      ['ＡＤＡ', 'ada'],
    ])('folds %p onto %p', (input, expected) => {
      expect(normalizePersonName(input)).toBe(expected);
    });

    /** A regex over `[a-z]` would reduce these to "" and collide them all. */
    it('keeps letters of non-Latin scripts', () => {
      expect(normalizePersonName('محمد')).toBe('محمد');
      expect(normalizePersonName('محمد')).not.toBe(normalizePersonName('أحمد'));
    });
  });

  describe('normalizePhoneForMatching', () => {
    it('keeps only digits and the leading plus', () => {
      expect(normalizePhoneForMatching('+216 20-123 456')).toBe('+21620123456');
      expect(normalizePhoneForMatching(null)).toBe('');
    });
  });

  describe('participantFingerprint', () => {
    it('is a stable hexadecimal SHA-256', () => {
      expect(participantFingerprint(ada)).toMatch(/^[0-9a-f]{64}$/);
      expect(participantFingerprint(ada)).toBe(participantFingerprint(ada));
    });

    it('matches through case, accents, spacing and phone formatting', () => {
      expect(
        participantFingerprint({
          firstName: ' ADA ',
          lastName: 'Lovelacé',
          email: 'ADA@example.com',
          phone: '+216 20 123 456',
        }),
      ).toBe(participantFingerprint(ada));
    });

    it('matches a first and last name swapped', () => {
      expect(
        participantFingerprint({
          ...ada,
          firstName: ada.lastName,
          lastName: ada.firstName,
        }),
      ).toBe(participantFingerprint(ada));
    });

    it.each([
      ['email', { email: 'ada@other.example' }],
      ['phone', { phone: '+21620999999' }],
      ['name', { firstName: 'Augusta' }],
    ])('separates participants differing by %s', (_label, change) => {
      expect(participantFingerprint({ ...ada, ...change })).not.toBe(
        participantFingerprint(ada),
      );
    });

    /**
     * The case the signal exists for: a walk-in with neither email nor phone
     * entered twice. Nothing unique catches it; the fingerprint does.
     */
    it('matches two participants known by name alone', () => {
      const walkIn = {
        firstName: 'Sami',
        lastName: 'Ben Ali',
        email: null,
        phone: null,
      };

      expect(participantFingerprint(walkIn)).toBe(
        participantFingerprint({ ...walkIn, lastName: 'ben-ali' }),
      );
    });

    /** Field boundaries are separated, so shifting text across them cannot collide. */
    it('does not collide when text moves between fields', () => {
      expect(
        participantFingerprint({
          firstName: 'a',
          lastName: 'b c',
          email: null,
          phone: null,
        }),
      ).not.toBe(
        participantFingerprint({
          firstName: 'a b',
          lastName: 'c',
          email: null,
          phone: null,
        }),
      );
    });
  });
});
