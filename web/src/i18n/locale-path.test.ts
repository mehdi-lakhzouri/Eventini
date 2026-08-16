import { describe, expect, it } from "vitest";

import { localePrefixOf, stripLocalePrefix } from "./locale-path";

describe("localePrefixOf", () => {
  it.each([
    ["/en/organization", "/en"],
    ["/fr/organization", "/fr"],
    ["/en", "/en"],
    ["/organization", ""],
    ["/", ""],
  ])("reads %s as %s", (pathname, expected) => {
    expect(localePrefixOf(pathname)).toBe(expected);
  });

  /**
   * 🔴 `/france` commence par `/fr`.
   *
   * Un `startsWith` naïf le découperait en locale `fr` + chemin `ance`, et le
   * proxy comparerait `ance` à sa liste de chemins publics — donc classerait
   * une page publique comme protégée. Le test existe pour que la frontière de
   * segment ne disparaisse pas à la première réécriture.
   */
  it.each(["/france", "/english", "/frais", "/enrollment"])(
    "does not mistake %s for a locale prefix",
    (pathname) => {
      expect(localePrefixOf(pathname)).toBe("");
    },
  );
});

describe("stripLocalePrefix", () => {
  it.each([
    ["/en/organization/members", "/organization/members"],
    ["/fr/login", "/login"],
    ["/organization", "/organization"],
  ])("turns %s into %s", (pathname, expected) => {
    expect(stripLocalePrefix(pathname)).toBe(expected);
  });

  /**
   * `/en` seul doit rendre `/`, pas `""`.
   *
   * La chaîne vide ne correspond à aucune entrée de `routes`, donc la racine
   * cesserait d'être reconnue comme publique et le proxy renverrait un
   * visiteur anonyme de `/en` vers la connexion.
   */
  it.each([
    ["/en", "/"],
    ["/fr", "/"],
  ])("turns the bare prefix %s into %s", (pathname, expected) => {
    expect(stripLocalePrefix(pathname)).toBe(expected);
  });

  it("leaves a lookalike path untouched", () => {
    expect(stripLocalePrefix("/france")).toBe("/france");
  });
});
