import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  DEFAULT_INVITATION_ROLE,
  assignableRoleLabel,
} from "./assignable-roles";

/**
 * Le catalogue est en dur faute de route qui l'expose — voir la note du
 * fichier. Ces tests figent ce que la liste doit rester tant que ce gap n'est
 * pas comblé.
 */
describe("assignable roles", () => {
  /**
   * 🔴 Interrogé en base le 16 août 2026 : `CLIENT_ADMIN` est le **seul** rôle
   * de portée `ORGANIZATION`. Les quatre autres du catalogue seedé sont
   * `EVENT`-scopés et passent par `event_user_assignments` (sprint 09+),
   * `SUPER_ADMIN` est `PLATFORM`.
   *
   * Si ce test tombe, c'est soit que le catalogue a bougé — et il faut le
   * revérifier en base plutôt que corriger l'attendu — soit que quelqu'un a
   * ajouté un rôle ici de mémoire.
   */
  it("offers exactly the ORGANIZATION-scoped roles the catalogue seeds", () => {
    expect(ASSIGNABLE_ROLES.map((role) => role.code)).toEqual(["CLIENT_ADMIN"]);
  });

  /** Un rôle proposé mais refusé par le backend renverrait un `400` opaque. */
  it.each(["SUPER_ADMIN", "EVENT_ADMIN", "SCANNER", "REPORT_VIEWER"])(
    "does not offer %s",
    (code) => {
      expect(ASSIGNABLE_ROLES.some((role) => role.code === code)).toBe(false);
    },
  );

  it("defaults to a role that is actually in the list", () => {
    expect(
      ASSIGNABLE_ROLES.some((role) => role.code === DEFAULT_INVITATION_ROLE),
    ).toBe(true);
  });

  it("labels a known code in French", () => {
    expect(assignableRoleLabel("CLIENT_ADMIN")).toBe("Administrateur");
  });

  /**
   * Un code inconnu ressort tel quel plutôt qu'en « — ».
   *
   * La table des membres affiche `roleCodes` venus du backend, qui peut
   * contenir un rôle que cette liste ignore — un rôle `EVENT` accordé
   * ailleurs, au sprint 09. Le masquer ferait croire à un membre sans rôle.
   */
  it("falls back to the raw code rather than hiding it", () => {
    expect(assignableRoleLabel("EVENT_ADMIN")).toBe("EVENT_ADMIN");
  });
});
