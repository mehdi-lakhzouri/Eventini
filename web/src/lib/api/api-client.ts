import { environment } from "@/config/environment";
import { ApiError } from "./api-error";
import { withCsrfHeader } from "./csrf-client";
import {
  isApiEnvelope,
  parseProblemBody,
  type ApiEnvelope,
} from "./problem-details";
import { refreshSessionOnce } from "./session-refresh";
import {
  serializeRequestBody,
  shouldSetJsonContentType,
  type RequestBody,
} from "./request-body";

/**
 * `body` is omitted from `RequestInit` before being re-added.
 *
 * Intersecting instead of omitting gave `body` the type
 * `(BodyInit | null) & (BodyInit | Record<string, unknown> | undefined)`,
 * which nothing can satisfy — the three TS2345/TS2322 errors this ticket
 * cleared.
 */
export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  body?: RequestBody;
  /**
   * Rend l'opération rejouable sans double effet.
   * `IDEMPOTENCY_AND_CONCURRENCY.md` §4.
   */
  idempotencyKey?: string;
  /** Verrouillage optimiste : l'`ETag` reçu à la lecture. */
  ifMatch?: string;
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function buildHeaders(method: string, options: ApiRequestOptions): Headers {
  const headers = MUTATING_METHODS.has(method)
    ? withCsrfHeader(options.headers)
    : new Headers(options.headers);

  if (shouldSetJsonContentType(options.body)) {
    headers.set("Content-Type", "application/json");
  }

  if (options.idempotencyKey !== undefined) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  if (options.ifMatch !== undefined) {
    headers.set("If-Match", options.ifMatch);
  }

  return headers;
}

/**
 * Lit le corps une seule fois, sans jamais lancer.
 *
 * `response.json()` échoue sur un corps vide comme sur une page HTML d'erreur,
 * et un flux ne se lit qu'une fois : une tentative ratée consommerait le corps
 * pour tout le monde. D'où la lecture en texte, puis l'analyse.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Les chemins qui ne doivent jamais déclencher de rotation sur `401`.
 *
 * `POST /auth/sessions` est la connexion : un `401` y signifie « identifiants
 * refusés », et tenter une rotation reviendrait à répondre à un mauvais mot de
 * passe en rafraîchissant une session qui n'existe pas.
 *
 * La route de rotation elle-même est exclue par construction — le coordinateur
 * émet son propre `fetch` et ne repasse pas ici — mais elle figure dans la
 * liste pour que quiconque la câblerait un jour via `apiClient` ne réintroduise
 * pas la récursion.
 */
const NO_RETRY_PATHS = ["/auth/sessions", "/auth/sessions/current/rotation"];

function isRetryablePath(path: string, method: string): boolean {
  // Seul le POST vers /auth/sessions est la connexion. Le GET liste les
  // sessions et mérite un rattrapage comme n'importe quelle lecture.
  if (path === "/auth/sessions" && method.toUpperCase() !== "POST") {
    return true;
  }

  return !NO_RETRY_PATHS.includes(path);
}

/**
 * Une requête, et l'enveloppe complète qu'elle rend.
 *
 * Séparée de `request` parce que `meta` porte la pagination par curseur
 * (`API_CONVENTIONS.md` §6) et le marqueur de rejeu d'idempotence : une liste
 * paginée a besoin de `meta.pagination.nextCursor`, que dépaqueter `data`
 * jetterait.
 */
async function requestEnvelope<T>(
  path: string,
  method: string,
  options: ApiRequestOptions = {},
  /**
   * Faux dès la seconde tentative. Une requête ne provoque **jamais** deux
   * rotations : `401 → rotation → 401 → rotation` boucle jusqu'à ce que le
   * backend traite le client comme un attaquant.
   */
  mayRetry = true,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${environment.apiBaseUrl}${path}`, {
    ...options,
    method,
    headers: buildHeaders(method, options),
    // Cookie-based authentication: the access, refresh and CSRF cookies are
    // HttpOnly and must ride along. No token is ever read from JavaScript
    // (AUTH-INV-001).
    credentials: "include",
    body: serializeRequestBody(options.body),
  });

  // 204 n'a pas de corps : le lire renverrait `null` et l'enveloppe serait
  // fabriquée de toutes pièces. On la fabrique explicitement.
  if (response.status === 204) {
    return {
      data: null,
      error: null,
      meta: {
        requestId: response.headers.get("X-Request-Id") ?? "",
        timestamp: new Date().toISOString(),
        apiVersion: "v1",
      },
    };
  }

  /*
    Le rattrapage sur 401 — EVT-038.

    Placé avant la lecture du corps : la réponse expirée n'a rien à apprendre à
    l'appelant, seule la seconde tentative compte. Placé après le cas 204, qui
    ne peut pas être un 401.

    `refreshSessionOnce` déduplique : dix requêtes expirées en même temps
    produisent une seule rotation. Sans cela, les neuf retardataires
    présenteraient un refresh token déjà consommé et le backend révoquerait la
    famille entière pour rejeu — voir `session-refresh.ts`.
  */
  if (
    response.status === 401 &&
    mayRetry &&
    isRetryablePath(path, method) &&
    (await refreshSessionOnce())
  ) {
    return requestEnvelope<T>(path, method, options, false);
  }

  const body = await readBody(response);
  const { problem, requestId } = parseProblemBody(body);

  if (!response.ok) {
    throw problem === null
      ? ApiError.fromResponse(
          response.status,
          response.statusText,
          requestId ?? response.headers.get("X-Request-Id") ?? undefined,
        )
      : ApiError.fromProblem(problem, requestId, response.status);
  }

  /*
    Une réponse 2xx portant un `error` non nul ne devrait pas exister, mais la
    traiter comme un succès livrerait `data: null` à un appelant qui attend une
    ressource — et l'échec ressortirait bien plus loin, sous la forme d'un accès
    à une propriété de `null`.
  */
  if (isApiEnvelope(body)) {
    if (body.error !== null) {
      throw ApiError.fromProblem(
        parseProblemBody(body).problem ?? {
          type: "about:blank",
          title: "Réponse incohérente",
          status: response.status,
          code: "UNKNOWN_ERROR",
          detail: "",
          instance: "",
          errors: [],
          retryable: false,
          extensions: {},
        },
        requestId,
        response.status,
      );
    }

    return body as ApiEnvelope<T>;
  }

  // Réponse hors enveloppe : conservée telle quelle plutôt que rejetée. Rien
  // dans l'API ne devrait en produire, mais échouer ici transformerait une
  // réponse simplement inattendue en panne.
  return {
    data: body as T,
    error: null,
    meta: {
      requestId: requestId ?? "",
      timestamp: new Date().toISOString(),
      apiVersion: "v1",
    },
  };
}

/**
 * Le cas courant : rend `data`, pas l'enveloppe.
 *
 * Avant EVT-037, `apiClient.get<CurrentUser>()` rendait `{ data, meta, error }`
 * en le typant `CurrentUser`. Le type mentait sur toute la ligne : chaque
 * appelant lisant `user.firstName` aurait trouvé `undefined`, sans erreur de
 * compilation pour le prévenir.
 */
async function request<T>(
  path: string,
  method: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const envelope = await requestEnvelope<T>(path, method, options);

  return envelope.data as T;
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, "GET", options),
  post: <T>(path: string, body?: RequestBody, options?: ApiRequestOptions) =>
    request<T>(path, "POST", { ...options, body }),
  put: <T>(path: string, body?: RequestBody, options?: ApiRequestOptions) =>
    request<T>(path, "PUT", { ...options, body }),
  patch: <T>(path: string, body?: RequestBody, options?: ApiRequestOptions) =>
    request<T>(path, "PATCH", { ...options, body }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, "DELETE", options),

  /** Pour les listes paginées et les rejeux d'idempotence, qui lisent `meta`. */
  getEnvelope: <T>(path: string, options?: ApiRequestOptions) =>
    requestEnvelope<T>(path, "GET", options),
};
