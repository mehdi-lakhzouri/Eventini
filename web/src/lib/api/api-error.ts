import type { FieldError, ProblemDetails } from "./problem-details";

export interface ApiErrorInit {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
  readonly retryable?: boolean;
  readonly requestId?: string;
  /** Le problème brut, quand la réponse en portait un d'exploitable. */
  readonly problem?: ProblemDetails | null;
}

/**
 * Une réponse HTTP en échec, avec ce que le backend en a dit.
 *
 * Avant EVT-037, cette classe était construite avec `response.statusText` et
 * rien d'autre : l'enveloppe RFC 9457 était **lue puis jetée**. L'utilisateur
 * voyait « Bad Request » là où le backend avait envoyé un message précis, et le
 * formulaire ne pouvait marquer aucun champ.
 *
 * Le constructeur prend un objet plutôt qu'une liste d'arguments. Sept
 * paramètres positionnels dont quatre optionnels finissent par être passés dans
 * le désordre, et rien ne le signale : `code` et `title` sont tous deux des
 * chaînes.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  /**
   * Toujours un tableau, jamais `undefined`.
   *
   * EVT-040 écrit `error.errors.forEach(...)` directement dans le gestionnaire
   * de soumission. Rendre ce champ optionnel déplacerait une garde sur chaque
   * formulaire, et l'oubli produirait un plantage au moment précis où
   * l'utilisateur vient d'échouer à se connecter.
   */
  readonly errors: readonly FieldError[];
  readonly retryable: boolean;
  /**
   * Affiché dans les messages d'erreur techniques. Un utilisateur qui signale
   * `req_01JABC` permet de retrouver la requête exacte dans les logs.
   */
  readonly requestId: string | undefined;
  readonly problem: ProblemDetails | null;

  constructor(init: ApiErrorInit) {
    // `detail` d'abord : c'est la phrase écrite pour un humain. `title` est la
    // catégorie, utile en repli mais générique.
    super(init.detail && init.detail.length > 0 ? init.detail : init.title);

    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail ?? "";
    this.errors = init.errors ?? [];
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId;
    this.problem = init.problem ?? null;
  }

  /** Construit l'erreur depuis un problème conforme. */
  static fromProblem(
    problem: ProblemDetails,
    requestId: string | undefined,
    fallbackStatus: number,
  ): ApiError {
    return new ApiError({
      // Le statut du corps fait foi quand il est présent : c'est celui que le
      // backend a décidé. Un intermédiaire peut réécrire le statut HTTP.
      status: problem.status > 0 ? problem.status : fallbackStatus,
      code: problem.code,
      title: problem.title,
      detail: problem.detail,
      errors: problem.errors,
      retryable: problem.retryable,
      requestId,
      problem,
    });
  }

  /**
   * Repli lorsque la réponse ne porte pas d'enveloppe exploitable — un 502
   * émis par un reverse proxy, une page HTML, un corps vide.
   */
  static fromResponse(
    status: number,
    statusText: string,
    requestId: string | undefined,
  ): ApiError {
    return new ApiError({
      status,
      code: "UNKNOWN_ERROR",
      title: statusText.length > 0 ? statusText : `HTTP ${status}`,
      requestId,
      // `retryable` reste faux : sans information du backend, réessayer
      // automatiquement est une supposition, et une supposition qui peut
      // rejouer une opération non idempotente.
      retryable: false,
    });
  }

  /** Vrai si le champ nommé porte une erreur de validation. */
  hasFieldError(field: string): boolean {
    return this.errors.some((error) => error.field === field);
  }
}
