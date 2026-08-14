import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "./api-client";
import { ApiError } from "./api-error";
import {
  isRotationInFlight,
  refreshSessionOnce,
  resetSessionRefreshState,
  setSessionLostHandler,
} from "./session-refresh";

/**
 * Le critère de sortie du sprint 07 :
 * **dix requêtes recevant `401` déclenchent UNE rotation, pas dix.**
 *
 * Ce n'est pas une question de performance. Dix rotations concurrentes
 * présentent le même refresh token ; la première le consomme, les neuf autres
 * en présentent un `CONSUMED`, et le backend applique sa détection de rejeu en
 * révoquant la famille entière (AUTH-INV-003). L'utilisateur légitime est
 * déconnecté par la mesure censée le protéger d'un vol de jeton.
 */

const ROTATION = "/auth/sessions/current/rotation";

const fetchMock = vi.fn();

function meta() {
  return {
    requestId: "req_01JABC",
    timestamp: "2026-08-14T10:00:00.000Z",
    apiVersion: "v1",
  };
}

const unauthorized = () =>
  new Response(
    JSON.stringify({
      data: null,
      meta: meta(),
      error: {
        type: "about:blank",
        title: "Authentification requise",
        status: 401,
        code: "AUTHENTICATION_REQUIRED",
        detail: "",
        instance: "",
        errors: [],
        retryable: false,
        extensions: {},
      },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );

const ok = (data: unknown = { userId: "usr_1" }) =>
  new Response(JSON.stringify({ data, meta: meta(), error: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function rotationCalls(): number {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).endsWith(ROTATION),
  ).length;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  resetSessionRefreshState();
  setSessionLostHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionRefreshState();
  setSessionLostHandler(null);
});

describe("rotation en vol unique", () => {
  it("🔴 dix requêtes expirées déclenchent UNE rotation, pas dix", async () => {
    // Chaque appel métier échoue une fois, réussit ensuite ; la rotation
    // réussit. L'ordre d'arrivée est celui d'un vrai tableau de bord :
    // les dix partent avant que la première réponse ne revienne.
    const seen = new Map<string, number>();

    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith(ROTATION)) {
        // Une latence réelle : sans elle, la première rotation se résoudrait
        // avant que la deuxième requête n'atteigne le coordinateur, et le test
        // passerait même sans déduplication.
        return new Promise((resolve) =>
          setTimeout(() => resolve(new Response(null, { status: 204 })), 10),
        );
      }

      const count = (seen.get(url) ?? 0) + 1;
      seen.set(url, count);

      return Promise.resolve(count === 1 ? unauthorized() : ok());
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        apiClient.get(`/events/evt_${index}`),
      ),
    );

    expect(rotationCalls()).toBe(1);
    expect(results).toHaveLength(10);
    // Et les dix aboutissent : dédupliquer ne doit pas en sacrifier neuf.
    expect(results.every((entry) => entry !== null)).toBe(true);
  });

  it("rejoue la requête d'origine une fois la rotation réussie", async () => {
    let attempts = 0;

    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith(ROTATION)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      attempts += 1;
      return Promise.resolve(
        attempts === 1 ? unauthorized() : ok({ userId: "usr_1" }),
      );
    });

    await expect(apiClient.get("/auth/me")).resolves.toEqual({
      userId: "usr_1",
    });
    expect(attempts).toBe(2);
  });

  it("ne tente jamais deux rotations pour une même requête", async () => {
    // Le serveur répond 401 même après une rotation réussie — le cas d'un
    // compte désactivé entre-temps. Sans le garde-fou, ceci boucle jusqu'à ce
    // que le backend traite le client comme un attaquant.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith(ROTATION)
          ? new Response(null, { status: 204 })
          : unauthorized(),
      ),
    );

    const error = (await apiClient
      .get("/auth/me")
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(rotationCalls()).toBe(1);
  });

  describe("rotation en échec", () => {
    it("purge le cache et redirige, une seule fois pour dix requêtes", async () => {
      const onLost = vi.fn();
      setSessionLostHandler(onLost);

      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith(ROTATION)
            ? new Response(null, { status: 401 })
            : unauthorized(),
        ),
      );

      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          apiClient.get(`/events/evt_${index}`).catch(() => null),
        ),
      );

      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it("cesse de tenter des rotations tant qu'aucune connexion n'a eu lieu", async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith(ROTATION)
            ? new Response(null, { status: 401 })
            : unauthorized(),
        ),
      );

      await apiClient.get("/auth/me").catch(() => null);
      expect(rotationCalls()).toBe(1);

      // Une requête ultérieure ne relance pas une rotation vouée à échouer :
      // dix requêtes en cours produiraient sinon dix événements de sécurité
      // pendant que la redirection se joue.
      await apiClient.get("/events").catch(() => null);
      expect(rotationCalls()).toBe(1);
    });

    it("rouvre la voie après une reconnexion", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await refreshSessionOnce();

      resetSessionRefreshState();

      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await expect(refreshSessionOnce()).resolves.toBe(true);
    });

    it("traite une panne réseau comme un échec, sans lancer", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(refreshSessionOnce()).resolves.toBe(false);
    });
  });

  describe("routes exclues", () => {
    it("n'essaie pas de rafraîchir une connexion refusée", async () => {
      fetchMock.mockResolvedValue(unauthorized());

      await apiClient
        .post("/auth/sessions", { email: "a@b.fr", password: "x" })
        .catch(() => null);

      // Rafraîchir ici répondrait à un mauvais mot de passe en rafraîchissant
      // une session qui n'existe pas.
      expect(rotationCalls()).toBe(0);
    });

    it("rattrape en revanche la LISTE des sessions, qui est une lecture", async () => {
      let attempts = 0;

      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith(ROTATION)) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        attempts += 1;
        return Promise.resolve(attempts === 1 ? unauthorized() : ok([]));
      });

      await apiClient.get("/auth/sessions");

      expect(rotationCalls()).toBe(1);
    });
  });

  describe("état du module", () => {
    it("libère la promesse partagée une fois la rotation terminée", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      const pending = refreshSessionOnce();
      expect(isRotationInFlight()).toBe(true);

      await pending;
      // Sans cette remise à zéro, la première rotation serait la seule de toute
      // la vie de l'onglet, et la session suivante expirerait sans recours.
      expect(isRotationInFlight()).toBe(false);
    });

    it("rend la même promesse à deux appels concurrents", () => {
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(new Response(null, { status: 204 })), 5),
          ),
      );

      expect(refreshSessionOnce()).toBe(refreshSessionOnce());
    });
  });
});
