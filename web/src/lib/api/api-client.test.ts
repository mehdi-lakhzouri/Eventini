import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./api-client";
import { ApiError } from "./api-error";

/**
 * Le client API contre un `fetch` remplacé.
 *
 * Remplacer `fetch` plutôt que monter un serveur : ce qui est testé ici est la
 * traduction entre une réponse HTTP et ce que voit l'appelant — corps d'erreur,
 * dépaquetage de l'enveloppe, en-têtes. Un vrai serveur ajouterait de la
 * latence et de l'ordonnancement sans rien prouver de plus.
 */

const BASE = "http://localhost:3001/api/v1";

function meta(requestId = "req_01JABC") {
  return { requestId, timestamp: "2026-08-14T10:00:00.000Z", apiVersion: "v1" };
}

function jsonResponse(status: number, body: unknown, statusText = "") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  // Les cookies ne sont pas lisibles en jsdom ; le client se contente d'ajouter
  // l'en-tête CSRF quand il en trouve un.
  document.cookie = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const call = fetchMock.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("fetch n'a pas été appelé");
  }
  return { url: call[0] as string, init: call[1] as RequestInit };
}

describe("apiClient", () => {
  describe("enveloppe de succès", () => {
    /**
     * Le défaut le plus silencieux de la version précédente : `get<CurrentUser>`
     * rendait `{ data, meta, error }` en le typant `CurrentUser`. Chaque
     * appelant lisant `user.email` trouvait `undefined`, sans la moindre erreur
     * de compilation.
     */
    it("rend data, pas l'enveloppe", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          data: { userId: "usr_1", email: "ana@exemple.fr" },
          meta: meta(),
          error: null,
        }),
      );

      const user = await apiClient.get<{ userId: string; email: string }>(
        "/auth/me",
      );

      expect(user).toEqual({ userId: "usr_1", email: "ana@exemple.fr" });
    });

    it("expose meta quand l'appelant la demande, pour la pagination", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          data: [],
          meta: {
            ...meta(),
            pagination: {
              limit: 20,
              hasNextPage: true,
              hasPreviousPage: false,
              nextCursor: "eyJz",
              previousCursor: null,
            },
          },
          error: null,
        }),
      );

      const envelope = await apiClient.getEnvelope<unknown[]>("/events");

      expect(envelope.meta.pagination?.nextCursor).toBe("eyJz");
    });

    it("rend null sur 204 sans tenter de lire un corps absent", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      await expect(apiClient.delete("/auth/sessions/current")).resolves.toBeNull();
    });
  });

  describe("corps d'erreur RFC 9457", () => {
    it("remplit code, title, detail, retryable et requestId", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, {
          data: null,
          meta: meta("req_01JXYZ"),
          error: {
            type: "https://eventini.dev/errors/invalid-credentials",
            title: "Identifiants invalides",
            status: 401,
            code: "AUTH_INVALID_CREDENTIALS",
            detail: "L'adresse ou le mot de passe est incorrect.",
            instance: "/api/v1/auth/sessions",
            errors: [],
            retryable: false,
            extensions: {},
          },
        }),
      );

      const error = await apiClient
        .post("/auth/sessions", { email: "a@b.fr", password: "x" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      const api = error as ApiError;
      expect(api.code).toBe("AUTH_INVALID_CREDENTIALS");
      expect(api.status).toBe(401);
      expect(api.message).toBe("L'adresse ou le mot de passe est incorrect.");
      expect(api.requestId).toBe("req_01JXYZ");
      expect(api.retryable).toBe(false);
    });

    it("transporte les erreurs de champ jusqu'au formulaire", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          data: null,
          meta: meta(),
          error: {
            type: "about:blank",
            title: "Requête invalide",
            status: 400,
            code: "VALIDATION_FAILED",
            detail: "",
            instance: "",
            errors: [
              { field: "email", code: "REQUIRED", message: "Requis." },
              // Entrée incomplète : écartée plutôt que complétée, sinon
              // `form.setError` viserait un champ inexistant.
              { field: "password" },
            ],
            retryable: false,
            extensions: {},
          },
        }),
      );

      const error = (await apiClient
        .post("/auth/sessions")
        .catch((caught: unknown) => caught)) as ApiError;

      expect(error.errors).toHaveLength(1);
      expect(error.errors[0]).toEqual({
        field: "email",
        code: "REQUIRED",
        message: "Requis.",
      });
    });

    it("conserve les extensions, dont challengeId pour la MFA", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, {
          data: null,
          meta: meta(),
          error: {
            type: "about:blank",
            title: "MFA requise",
            status: 401,
            code: "AUTH_MFA_REQUIRED",
            detail: "",
            instance: "",
            errors: [],
            retryable: false,
            extensions: { challengeId: "chl_01JABC" },
          },
        }),
      );

      const error = (await apiClient
        .post("/auth/sessions")
        .catch((caught: unknown) => caught)) as ApiError;

      expect(error.code).toBe("AUTH_MFA_REQUIRED");
      expect(error.problem?.extensions.challengeId).toBe("chl_01JABC");
    });

    /** Un 502 de reverse proxy n'a jamais la forme attendue. */
    it("retombe sur le statut quand le corps n'est pas du JSON", async () => {
      fetchMock.mockResolvedValue(
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }),
      );

      const error = (await apiClient
        .get("/auth/me")
        .catch((caught: unknown) => caught)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(502);
      expect(error.code).toBe("UNKNOWN_ERROR");
      expect(error.message).toBe("Bad Gateway");
    });

    it("ne lance pas sur un corps d'erreur vide", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

      const error = (await apiClient
        .get("/auth/me")
        .catch((caught: unknown) => caught)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(500);
    });

    /**
     * Une 2xx portant un `error` non nul ne devrait pas exister. La traiter
     * comme un succès livrerait `data: null` à un appelant qui attend une
     * ressource, et l'échec ressortirait bien plus loin.
     */
    it("refuse une 200 qui porte quand même une erreur", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          data: null,
          meta: meta(),
          error: {
            type: "about:blank",
            title: "Incohérent",
            status: 200,
            code: "UNKNOWN_ERROR",
            detail: "",
            instance: "",
            errors: [],
            retryable: false,
            extensions: {},
          },
        }),
      );

      await expect(apiClient.get("/auth/me")).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("requête sortante", () => {
    it("vise l'URL de base et transporte les cookies", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { data: null, meta: meta(), error: null }),
      );

      await apiClient.get("/auth/me");
      const { url, init } = lastRequest();

      expect(url).toBe(`${BASE}/auth/me`);
      expect(init.credentials).toBe("include");
    });

    it("pose Idempotency-Key quand il est fourni", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(201, { data: null, meta: meta(), error: null }),
      );

      await apiClient.post("/events", { name: "x" }, {
        idempotencyKey: "idem_01JABC",
      });

      const headers = new Headers(lastRequest().init.headers);
      expect(headers.get("Idempotency-Key")).toBe("idem_01JABC");
    });

    it("pose If-Match quand il est fourni", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { data: null, meta: meta(), error: null }),
      );

      await apiClient.patch("/events/evt_1", { name: "y" }, {
        ifMatch: '"v3"',
      });

      const headers = new Headers(lastRequest().init.headers);
      expect(headers.get("If-Match")).toBe('"v3"');
    });

    it("n'ajoute aucun de ces en-têtes quand ils ne sont pas demandés", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { data: null, meta: meta(), error: null }),
      );

      await apiClient.get("/auth/me");

      const headers = new Headers(lastRequest().init.headers);
      expect(headers.has("Idempotency-Key")).toBe(false);
      expect(headers.has("If-Match")).toBe(false);
    });

    it("expose put et patch, présents dans les méthodes mutantes", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { data: null, meta: meta(), error: null }),
      );

      await apiClient.put("/a", { v: 1 });
      expect(lastRequest().init.method).toBe("PUT");

      await apiClient.patch("/a", { v: 1 });
      expect(lastRequest().init.method).toBe("PATCH");
    });
  });
});
