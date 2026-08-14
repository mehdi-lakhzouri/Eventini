import { environment } from "@/config/environment";
import { ApiError } from "./api-error";
import { withCsrfHeader } from "./csrf-client";
import {
  isApiEnvelope,
  parseProblemBody,
  type ApiEnvelope,
} from "./problem-details";
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
 * Une requête, et l'enveloppe complète qu'elle rend.
 *
 * Sépare de `request` parce que `meta` porte la pagination par curseur
 * (`API_CONVENTIONS.md` §6) et le marqueur de rejeu d'idempotence : une liste
 * paginée a besoin de `meta.pagination.nextCursor`, que dépaqueter `data`
 * jetterait.
 */
async function requestEnvelope<T>(
  path: string,
  method: string,
  options: ApiRequestOptions = {},
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
