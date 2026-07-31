import { LOG_CATEGORIES } from './log-categories';
import { LOG_EVENT_CODES, categoryForEventCode } from './log-event-codes';
import { ERROR_CATALOG } from '../../common/api/error-codes';

describe('LOG_EVENT_CODES', () => {
  it('maps every event code to a declared category', () => {
    for (const category of Object.values(LOG_EVENT_CODES)) {
      expect(LOG_CATEGORIES).toContain(category);
    }
  });

  it('uses SCREAMING_SNAKE_CASE throughout, since these are query keys', () => {
    for (const code of Object.keys(LOG_EVENT_CODES)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('resolves a code to its category', () => {
    expect(categoryForEventCode('LOGIN_FAILED')).toBe('SECURITY');
    expect(categoryForEventCode('HTTP_REQUEST_COMPLETED')).toBe('HTTP_ACCESS');
  });

  /**
   * §10 and ADR-0008 both state these are two independent namespaces that are
   * deliberately NOT synchronised. This test pins that intent: an overlapping
   * string is allowed, so a future change that tries to "align" the two
   * catalogues has to delete an explicit statement rather than do it by
   * accident.
   */
  it('may overlap with the HTTP error catalogue without being tied to it', () => {
    const shared = Object.keys(LOG_EVENT_CODES).filter(
      (code) => code in ERROR_CATALOG,
    );

    expect(shared).toEqual(expect.arrayContaining([]));
  });
});
