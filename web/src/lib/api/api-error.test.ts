import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";
import type { ProblemDetails } from "./problem-details";

/**
 * Le contrat d'`ApiError` après EVT-037.
 *
 * La version précédente de ce fichier documentait un constructeur positionnel
 * `(message, status, details?)` en annonçant qu'EVT-037 l'élargirait, et que
 * « les bases affirmées ici doivent continuer de tenir ». Ce sont bien des
 * **comportements** qui tiennent — `instanceof`, `name`, `status`, un message
 * lisible — et non la signature : sept paramètres positionnels dont quatre
 * optionnels, avec `code` et `title` tous deux de type `string`, finissent par
 * être passés dans le désordre sans que rien ne le signale.
 */

const problem: ProblemDetails = {
  type: "https://eventini.dev/errors/validation-failed",
  title: "Requête invalide",
  status: 400,
  code: "VALIDATION_FAILED",
  detail: "Deux champs sont refusés.",
  instance: "/api/v1/auth/sessions",
  errors: [
    { field: "email", code: "REQUIRED", message: "L'adresse est requise." },
    { field: "password", code: "TOO_SHORT", message: "Trop court." },
  ],
  retryable: false,
  extensions: {},
};

describe("ApiError", () => {
  it("reste une vraie Error, donc instanceof et try/catch se comportent normalement", () => {
    const error = new ApiError({
      status: 404,
      code: "NOT_FOUND",
      title: "Introuvable",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("se nomme ApiError plutôt qu'Error", () => {
    // Sans l'affectation explicite dans le constructeur, ceci vaut « Error »,
    // ce qui rend les traces de production ambiguës.
    expect(
      new ApiError({ status: 500, code: "INTERNAL_ERROR", title: "boom" }).name,
    ).toBe("ApiError");
  });

  it("porte le statut HTTP", () => {
    const error = new ApiError({
      status: 403,
      code: "AUTH_TENANT_DENIED",
      title: "Accès refusé",
    });

    expect(error.status).toBe(403);
  });

  describe("message", () => {
    it("préfère detail, la phrase écrite pour un humain", () => {
      const error = new ApiError({
        status: 400,
        code: "VALIDATION_FAILED",
        title: "Requête invalide",
        detail: "L'adresse électronique est déjà utilisée.",
      });

      expect(error.message).toBe("L'adresse électronique est déjà utilisée.");
    });

    it("retombe sur title quand detail est absent ou vide", () => {
      expect(
        new ApiError({ status: 404, code: "NOT_FOUND", title: "Introuvable" })
          .message,
      ).toBe("Introuvable");

      expect(
        new ApiError({
          status: 404,
          code: "NOT_FOUND",
          title: "Introuvable",
          detail: "",
        }).message,
      ).toBe("Introuvable");
    });
  });

  describe("errors", () => {
    /**
     * EVT-040 écrit `error.errors.forEach(...)` directement dans le
     * gestionnaire de soumission. Un `undefined` y planterait au moment précis
     * où l'utilisateur vient d'échouer à se connecter.
     */
    it("est toujours un tableau, jamais undefined", () => {
      const error = new ApiError({ status: 500, code: "X", title: "Y" });

      expect(error.errors).toEqual([]);
      expect(() => error.errors.forEach(() => undefined)).not.toThrow();
    });

    it("expose les erreurs de champ dans l'ordre reçu", () => {
      const error = ApiError.fromProblem(problem, "req_01JABC", 400);

      expect(error.errors.map((entry) => entry.field)).toEqual([
        "email",
        "password",
      ]);
    });

    it("répond hasFieldError sur le champ nommé", () => {
      const error = ApiError.fromProblem(problem, undefined, 400);

      expect(error.hasFieldError("email")).toBe(true);
      expect(error.hasFieldError("firstName")).toBe(false);
    });
  });

  describe("fromProblem", () => {
    it("reprend code, title, detail, retryable et requestId", () => {
      const error = ApiError.fromProblem(problem, "req_01JABC", 400);

      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.title).toBe("Requête invalide");
      expect(error.detail).toBe("Deux champs sont refusés.");
      expect(error.retryable).toBe(false);
      expect(error.requestId).toBe("req_01JABC");
      expect(error.problem).toEqual(problem);
    });

    /**
     * Le statut du corps fait foi : c'est celui que le backend a décidé. Un
     * intermédiaire — proxy, CDN — peut réécrire le statut de la réponse.
     */
    it("préfère le statut du corps à celui de la réponse", () => {
      const error = ApiError.fromProblem(problem, undefined, 502);

      expect(error.status).toBe(400);
    });

    it("retombe sur le statut de la réponse quand le corps n'en porte pas", () => {
      const error = ApiError.fromProblem(
        { ...problem, status: 0 },
        undefined,
        409,
      );

      expect(error.status).toBe(409);
    });
  });

  describe("fromResponse", () => {
    it("construit un repli exploitable quand le corps n'est pas conforme", () => {
      const error = ApiError.fromResponse(502, "Bad Gateway", undefined);

      expect(error.status).toBe(502);
      expect(error.code).toBe("UNKNOWN_ERROR");
      expect(error.message).toBe("Bad Gateway");
      expect(error.errors).toEqual([]);
      expect(error.problem).toBeNull();
    });

    it("nomme le statut quand statusText est vide", () => {
      expect(ApiError.fromResponse(503, "", undefined).title).toBe("HTTP 503");
    });

    /**
     * Sans information du backend, réessayer automatiquement est une
     * supposition — et une supposition qui peut rejouer une opération non
     * idempotente.
     */
    it("ne se déclare jamais réessayable de sa propre initiative", () => {
      expect(
        ApiError.fromResponse(502, "Bad Gateway", undefined).retryable,
      ).toBe(false);
    });
  });
});
