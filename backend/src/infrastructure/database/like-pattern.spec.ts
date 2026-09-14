import { escapeLikePattern } from './like-pattern';

describe('escapeLikePattern', () => {
  it.each([
    ['%%', '\\%\\%'],
    ['a_b', 'a\\_b'],
    ['50%', '50\\%'],
    ['back\\slash', 'back\\\\slash'],
    ['trailing\\', 'trailing\\\\'],
  ])('makes %p literal', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLikePattern("Jean-Pierre O'Connor")).toBe(
      "Jean-Pierre O'Connor",
    );
  });
});
