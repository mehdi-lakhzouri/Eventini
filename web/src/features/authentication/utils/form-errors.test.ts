import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/api-error";
import type { ProblemDetails } from "@/lib/api/problem-details";
import { applyApiErrorToForm, userMessageFor } from "./form-errors";

type LoginValues = { email: string; password: string };

const problem = (overrides: Partial<ProblemDetails> = {}): ProblemDetails => ({
  type: "about:blank",
  title: "Requête invalide",
  status: 400,
  code: "VALIDATION_ERROR",
  detail: "",
  instance: "",
  errors: [],
  retryable: false,
  extensions: {},
  ...overrides,
});

describe("applyApiErrorToForm", () => {
  it("place chaque erreur de champ sur le champ nommé", () => {
    const setError = vi.fn();
    const error = ApiError.fromProblem(
      problem({
        errors: [
          { field: "email", code: "REQUIRED", message: "Adresse requise." },
          { field: "password", code: "TOO_SHORT", message: "Trop court." },
        ],
      }),
      undefined,
      400,
    );

    applyApiErrorToForm<LoginValues>(error, setError, {
      knownFields: ["email", "password"],
    });

    expect(setError).toHaveBeenCalledWith("email", {
      message: "Adresse requise.",
    });
    expect(setError).toHaveBeenCalledWith("password", {
      message: "Trop court.",
    });
  });

  /**
   * `setError` sur un nom que React Hook Form ne connaît pas n'affiche rien :
   * le message disparaîtrait en silence et l'utilisateur verrait un formulaire
   * refusé sans qu'aucun champ ne s'explique.
   */
  it("bascule sur le message global quand le champ n'existe pas dans ce formulaire", () => {
    const setError = vi.fn();
    const error = ApiError.fromProblem(
      problem({
        detail: "Le champ organisation est invalide.",
        errors: [
          { field: "organizationId", code: "INVALID", message: "Inconnue." },
        ],
      }),
      undefined,
      400,
    );

    applyApiErrorToForm<LoginValues>(error, setError, {
      knownFields: ["email", "password"],
    });

    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("root", {
      message: "Le champ organisation est invalide.",
    });
  });

  it("place les champs connus et ignore les autres sans message global", () => {
    const setError = vi.fn();
    const error = ApiError.fromProblem(
      problem({
        errors: [
          { field: "email", code: "REQUIRED", message: "Adresse requise." },
          { field: "inconnu", code: "X", message: "Ignoré." },
        ],
      }),
      undefined,
      400,
    );

    applyApiErrorToForm<LoginValues>(error, setError, {
      knownFields: ["email", "password"],
    });

    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("email", {
      message: "Adresse requise.",
    });
  });

  it("rend une panne réseau lisible plutôt que le message brut de l'exception", () => {
    const setError = vi.fn();

    applyApiErrorToForm<LoginValues>(
      new TypeError("Failed to fetch"),
      setError,
      { knownFields: ["email", "password"] },
    );

    expect(setError).toHaveBeenCalledWith("root", {
      message:
        "La connexion au serveur a échoué. Vérifiez votre accès au réseau.",
    });
  });
});

describe("userMessageFor", () => {
  /**
   * 🔴 Le backend traite déjà une adresse inconnue exactement comme un mot de
   * passe faux. Préciser côté client défait ce travail depuis l'écran.
   */
  it("garde AUTH_INVALID_CREDENTIALS générique, sans distinguer les deux causes", () => {
    const message = userMessageFor(
      ApiError.fromProblem(
        problem({
          code: "AUTH_INVALID_CREDENTIALS",
          status: 401,
          detail: "Invalid email or password.",
        }),
        undefined,
        401,
      ),
    );

    expect(message).toBe("Adresse électronique ou mot de passe incorrect.");
    expect(message).not.toMatch(/compte|existe|inconnu|introuvable/i);
  });

  describe("limitation de débit", () => {
    const limited = (retryAfterSeconds?: number) =>
      ApiError.fromProblem(
        problem({ code: "RATE_LIMIT_EXCEEDED", status: 429, retryable: true }),
        undefined,
        429,
        retryAfterSeconds,
      );

    it("annonce le délai en secondes sous la minute", () => {
      expect(userMessageFor(limited(47))).toBe(
        "Trop de tentatives. Réessayez dans 47 secondes.",
      );
    });

    it("passe en minutes au-delà", () => {
      expect(userMessageFor(limited(120))).toBe(
        "Trop de tentatives. Réessayez dans 2 minutes.",
      );
      expect(userMessageFor(limited(61))).toBe(
        "Trop de tentatives. Réessayez dans 2 minutes.",
      );
    });

    /**
     * Sans délai, le message reste vague plutôt que d'en inventer un. Annoncer
     * « réessayez dans 0 seconde » inviterait à réessayer immédiatement, ce qui
     * prolonge le blocage au lieu de l'écouler.
     */
    it("reste vague quand l'en-tête Retry-After est absent", () => {
      expect(userMessageFor(limited())).toBe(
        "Trop de tentatives. Patientez quelques instants avant de réessayer.",
      );
    });
  });

  it("reprend le detail du backend pour les autres codes", () => {
    expect(
      userMessageFor(
        ApiError.fromProblem(
          problem({ code: "AUTH_TENANT_DENIED", detail: "Accès refusé." }),
          undefined,
          403,
        ),
      ),
    ).toBe("Accès refusé.");
  });

  it("retombe sur le titre quand le detail est vide", () => {
    expect(
      userMessageFor(
        ApiError.fromProblem(
          problem({ code: "INTERNAL_ERROR", title: "Erreur interne" }),
          undefined,
          500,
        ),
      ),
    ).toBe("Erreur interne");
  });
});
