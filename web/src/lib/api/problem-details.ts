/**
 * L'enveloppe de réponse du backend, côté client.
 *
 * Miroir de `backend/src/common/api/problem-details.types.ts` ([ADR-0008],
 * RFC 9457). Les deux fichiers doivent évoluer ensemble ; c'est un contrat
 * HTTP, pas un type partagé — le frontend ne dépend pas du paquet backend.
 */

/** Un échec de validation, au niveau du champ. `API_CONVENTIONS.md` §3. */
export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly errors: readonly FieldError[];
  readonly retryable: boolean;
  readonly extensions: Readonly<Record<string, string>>;
}

export interface PaginationMeta {
  readonly limit: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
}

export interface IdempotencyMeta {
  readonly replayed: true;
  readonly originalRequestId: string;
}

export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
  readonly apiVersion: "v1";
  readonly pagination?: PaginationMeta;
  readonly idempotency?: IdempotencyMeta;
}

/** `data` / `meta` / `error` sont toujours présents, y compris à l'échec. */
export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly meta: ResponseMeta;
  readonly error: ProblemDetails | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Lit `error.errors[]` en ignorant les entrées mal formées.
 *
 * Une entrée partielle est écartée plutôt que complétée : EVT-040 réinjecte
 * `field` dans `form.setError`, et un `field` inventé viserait un champ qui
 * n'existe pas — l'utilisateur verrait alors un formulaire refusé sans qu'aucun
 * champ ne porte de message.
 */
function parseFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): FieldError[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const field = asString(entry.field);
    const code = asString(entry.code);
    const message = asString(entry.message);

    return field !== undefined && code !== undefined && message !== undefined
      ? [{ field, code, message }]
      : [];
  });
}

export interface ParsedProblem {
  readonly problem: ProblemDetails | null;
  readonly requestId: string | undefined;
}

/**
 * Extrait le problème et l'identifiant de requête d'un corps de réponse.
 *
 * Tolérant par nécessité : un 502 émis par un reverse proxy, une page HTML
 * d'erreur ou un corps vide n'ont jamais la forme attendue, et ce sont
 * précisément les cas où l'utilisateur a le plus besoin d'un message. La
 * fonction ne lance donc jamais ; l'appelant retombe sur le statut HTTP.
 *
 * `requestId` est lu même quand `error` est absent : il vient de `meta`, que le
 * backend remplit sur toutes les réponses.
 */
export function parseProblemBody(body: unknown): ParsedProblem {
  if (!isRecord(body)) {
    return { problem: null, requestId: undefined };
  }

  const meta = isRecord(body.meta) ? body.meta : undefined;
  const requestId = meta ? asString(meta.requestId) : undefined;

  if (!isRecord(body.error)) {
    return { problem: null, requestId };
  }

  const error = body.error;
  const title = asString(error.title);
  const code = asString(error.code);

  // Sans code ni titre, il ne reste rien d'exploitable : autant traiter la
  // réponse comme non conforme plutôt que fabriquer un problème vide.
  if (title === undefined && code === undefined) {
    return { problem: null, requestId };
  }

  return {
    requestId,
    problem: {
      type: asString(error.type) ?? "about:blank",
      title: title ?? "",
      status: typeof error.status === "number" ? error.status : 0,
      code: code ?? "UNKNOWN_ERROR",
      detail: asString(error.detail) ?? "",
      instance: asString(error.instance) ?? "",
      errors: parseFieldErrors(error.errors),
      retryable: error.retryable === true,
      extensions: isRecord(error.extensions)
        ? Object.fromEntries(
            Object.entries(error.extensions).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {},
    },
  };
}

/**
 * Vrai si le corps a la forme de l'enveloppe du backend.
 *
 * Sert à décider s'il faut extraire `data` ou rendre le corps tel quel. Le test
 * porte sur `meta.requestId` : `data` seul ne suffirait pas, une ressource peut
 * légitimement s'appeler ainsi.
 */
export function isApiEnvelope(body: unknown): body is ApiEnvelope<unknown> {
  return (
    isRecord(body) &&
    "data" in body &&
    isRecord(body.meta) &&
    typeof body.meta.requestId === "string"
  );
}
