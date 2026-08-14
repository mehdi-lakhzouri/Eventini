import { environment } from "@/config/environment";

/**
 * CSRF transport concern. Lives in `lib/api/` rather than in the authentication
 * feature because `api-client.ts` needs it on every mutating request, and
 * `MODULE_DEPENDENCY_MAP.md` §7 forbids `lib/` from importing a feature.
 *
 * Names follow the contract in `AUTHENTICATION_AUTHORIZATION.md` §2 and
 * ADR-0016. The cookie was `csrf-token` here, which matched nothing on either
 * side — the backend has no CSRF implementation yet, so aligning the client to
 * the specification now is what makes the two meet when EVT-028 lands.
 */

/** Readable by JavaScript on purpose: it carries no authorization. */
export const CSRF_COOKIE_NAME = "__Host-eventini_csrf";

export const CSRF_HEADER_NAME = "X-CSRF-Token";

/**
 * Reads the double-submit token.
 *
 * Returns `null` on the server, where `document` does not exist: a Server
 * Component rendering this path must not crash, it simply has no token to send.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${CSRF_COOKIE_NAME}=`));

  if (cookie === undefined) {
    return null;
  }

  // slice, not split("="): a base64url token can legitimately contain "=" and
  // splitting would silently truncate it.
  const value = cookie.slice(CSRF_COOKIE_NAME.length + 1);

  return value === "" ? null : decodeURIComponent(value);
}

/**
 * Adds the CSRF header when a token is available, leaving the request untouched
 * when it is not.
 *
 * Sending an empty header would be worse than sending none: the server would
 * compare an empty header against a real cookie and record a mismatch that
 * looks like an attack in `security_events`.
 */
export function withCsrfHeader(headers: HeadersInit = {}): Headers {
  const token = readCsrfToken();
  const nextHeaders = new Headers(headers);

  if (token !== null) {
    nextHeaders.set(CSRF_HEADER_NAME, token);
  }

  return nextHeaders;
}

/** La rotation en cours d'obtention du jeton, s'il y en a une. */
let inFlight: Promise<void> | null = null;

/**
 * Obtient un jeton CSRF pré-session si le navigateur n'en a pas — EVT-040.
 *
 * ## 🔴 Sans cela, la toute première connexion échoue
 *
 * `withCsrfHeader` n'envoie l'en-tête que si le cookie existe. Or ce cookie
 * n'apparaît qu'après un appel à `GET /auth/csrf-token` — et rien ne l'appelait.
 * Un visiteur arrivant sur l'écran de connexion n'avait donc aucun jeton, la
 * requête partait sans en-tête, et le guard la refusait.
 *
 * Le symptôme aurait été trompeur au possible : un formulaire de connexion qui
 * échoue systématiquement, avec des identifiants parfaitement valides, pour une
 * raison qui n'a rien à voir avec eux.
 *
 * `GET` volontairement, donc non protégé par le guard qu'il alimente. Le jeton
 * n'autorise rien seul : il ne vaut que confronté au cookie de contexte
 * `HttpOnly` posé en même temps (ADR-0016). À la connexion, le backend le relie
 * à la session réelle — l'ancien cesse alors de vérifier.
 */
export async function ensureCsrfToken(): Promise<void> {
  if (typeof document === "undefined" || readCsrfToken() !== null) {
    return;
  }

  // Dédupliqué comme la rotation de session : deux formulaires soumis
  // simultanément ne doivent pas demander deux jetons, le second invalidant
  // le premier.
  inFlight ??= fetch(`${environment.apiBaseUrl}/auth/csrf-token`, {
    method: "GET",
    credentials: "include",
  })
    .then(() => undefined)
    // Un échec n'est pas relayé : la requête suivante partira sans en-tête et
    // le backend refusera avec son propre code d'erreur, ce qui est un
    // diagnostic plus utile qu'une panne au moment de l'amorçage.
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Pour les tests : remet l'amorçage à zéro entre deux cas. */
export function resetCsrfBootstrap(): void {
  inFlight = null;
}
