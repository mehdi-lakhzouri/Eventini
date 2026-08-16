import { describe, expect, it } from "vitest";

import {
  inviteMemberSchema,
  organizationProfileSchema,
} from "./organization.schema";

describe("organizationProfileSchema", () => {
  it("accepts a plain slug", () => {
    const result = organizationProfileSchema.safeParse({
      name: "Acme Events",
      slug: "acme-events",
    });

    expect(result.success).toBe(true);
  });

  /**
   * Les bornes viennent de `UpdateOrganizationDto`. Un formulaire plus
   * permissif que le serveur laisse partir une requête qui reviendra en `400`.
   */
  it.each([
    ["Acme", "-acme", "tiret en tête"],
    ["Acme", "acme-", "tiret en fin"],
    ["Acme", "Acme", "majuscules"],
    ["Acme", "ac me", "espace"],
    ["Acme", "ac", "trop court"],
    ["Acme", "acme--events", "double tiret"],
  ])("rejects %s / %s (%s)", (name, slug) => {
    expect(organizationProfileSchema.safeParse({ name, slug }).success).toBe(
      false,
    );
  });

  /**
   * 🔴 Les segments réservés viennent du backend, qui refuse de toute façon.
   * Les reprendre ici évite d'apprendre le refus après l'envoi.
   */
  it.each(["api", "admin", "new", "settings", "login"])(
    "rejects the reserved slug %s",
    (slug) => {
      expect(
        organizationProfileSchema.safeParse({ name: "Acme", slug }).success,
      ).toBe(false);
    },
  );

  it("trims before validating so a padded name is not rejected", () => {
    const result = organizationProfileSchema.safeParse({
      name: "  Acme  ",
      slug: "  acme  ",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.name).toBe("Acme");
    expect(result.success && result.data.slug).toBe("acme");
  });
});

describe("inviteMemberSchema", () => {
  it("accepts an ordinary address", () => {
    expect(
      inviteMemberSchema.safeParse({
        email: "person@example.fr",
        roleCode: "CLIENT_ADMIN",
      }).success,
    ).toBe(true);
  });

  /**
   * 🔴 Le format n'est volontairement pas strict.
   *
   * Le backend n'utilise pas `@IsEmail` non plus, et il documente pourquoi : la
   * normalisation d'adresse est faite d'un seul côté, et un validateur plus
   * sévère ici rejetterait des adresses que le serveur accepte. Ce test fige
   * l'intention — attraper la faute de frappe évidente, rien de plus — pour que
   * personne ne « corrige » le schéma en le durcissant.
   */
  it.each(["sans-arobase", "@example.fr", "person@", ""])(
    "rejects %s",
    (email) => {
      expect(
        inviteMemberSchema.safeParse({ email, roleCode: "CLIENT_ADMIN" })
          .success,
      ).toBe(false);
    },
  );

  it("requires a role", () => {
    expect(
      inviteMemberSchema.safeParse({ email: "a@b.fr", roleCode: "" }).success,
    ).toBe(false);
  });
});
