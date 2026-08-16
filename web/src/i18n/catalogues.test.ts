import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { LOCALES } from "./config";

type Catalogue = Record<string, unknown>;

/** Aplatit `{a: {b: "x"}}` en `["a.b"]`, pour comparer des ensembles de clés. */
function leafKeys(value: Catalogue, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;

    return typeof nested === "object" && nested !== null
      ? leafKeys(nested as Catalogue, path)
      : [path];
  });
}

const catalogues: Record<string, Catalogue> = { fr, en };

describe("message catalogues", () => {
  it("ships one catalogue per declared locale", () => {
    expect(Object.keys(catalogues).sort()).toEqual([...LOCALES].sort());
  });

  /**
   * 🔴 La parité n'est pas attrapée par le typage.
   *
   * `messages.d.ts` type les clés d'après le catalogue **français**, donc une
   * clé oubliée en anglais compile sans rien dire. À l'exécution, `next-intl`
   * se rabat sur la clé brute : un écran anglais afficherait
   * `navigation.dashboard` au milieu de son texte, sans erreur.
   */
  it("declares exactly the same keys in every locale", () => {
    const reference = leafKeys(fr).sort();

    for (const [locale, catalogue] of Object.entries(catalogues)) {
      expect(leafKeys(catalogue).sort(), `catalogue ${locale}`).toEqual(
        reference,
      );
    }
  });

  it("leaves no empty translation behind", () => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const empty = leafKeys(catalogue).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Catalogue)[key], catalogue);

        return typeof value !== "string" || value.trim() === "";
      });

      expect(empty, `catalogue ${locale}`).toEqual([]);
    }
  });

  /**
   * 🔴 Les identifiants ne se traduisent **jamais** — le ticket l'impose.
   *
   * Les codes d'erreur (`AUTH_TENANT_DENIED`), les codes d'événement et les
   * noms de permissions (`users.manage_roles`) sont des identifiants machine,
   * pas du texte. Un catalogue qui en contient signale que quelqu'un a
   * confondu « message affiché » et « code », et la traduction casserait
   * silencieusement une comparaison quelque part.
   *
   * Le test cherche la **forme** — SCREAMING_SNAKE_CASE — plutôt qu'une liste
   * de codes connus, qui serait périmée au ticket suivant.
   */
  it("never carries a machine identifier as a translated value", () => {
    const identifier = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const offending = leafKeys(catalogue).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Catalogue)[key], catalogue);

        return typeof value === "string" && identifier.test(value.trim());
      });

      expect(offending, `catalogue ${locale}`).toEqual([]);
    }
  });
});
