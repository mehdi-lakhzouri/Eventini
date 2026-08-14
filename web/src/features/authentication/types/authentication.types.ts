export type Role = "SUPER_ADMIN" | "CLIENT_ADMIN" | "SCANNER";

export type SessionClientType = "WEB" | "MOBILE_SCANNER" | "PLATFORM";

/** ADR-0009 : ce que la session a réellement prouvé, pas ce qu'elle prétend. */
export type AuthenticationLevel = "PASSWORD" | "MFA" | "REAUTHENTICATED";

export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING" | "DISABLED";

/**
 * L'utilisateur connecté, tel que `GET /auth/me` le renvoie.
 *
 *  Corrigé le 14 août 2026 (EVT-037). La version précédente déclarait
 * `{ id, email, role, organizationId, permissions }`. Le backend ne renvoie
 * **ni `id` ni `role` ni `permissions`** : la clé est `userId`, et les
 * permissions ne traversent jamais — [ADR-0004] les résout côté serveur à
 * chaque requête, précisément pour qu'un client ne puisse pas les présumer.
 *
 * Le type mentait donc sur trois champs, dont deux qu'un guard de route aurait
 * lus pour décider d'un affichage.
 */
export type CurrentUser = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  sessionId: string;
  /**
   * `null` pour une session plateforme — un `SUPER_ADMIN` hors de tout tenant —
   * et pour un utilisateur membre de plusieurs organisations qui n'en a pas
   * encore activé une. Dans les deux cas le client ne devine pas : il appelle
   * `POST /organizations/{organizationId}/activation` ([ADR-0002]).
   */
  organizationId: string | null;
  membershipId: string | null;
  clientType: SessionClientType;
  authenticationLevel: AuthenticationLevel;

  /**
   * Le contexte d'autorisation **consultatif** — EVT-039, ADR-0004.
   *
   * Il existe pour que l'interface évite d'afficher une action qui serait
   * refusée. Masquer un bouton inutilisable est une courtoisie, pas une
   * sécurité : chaque requête est réautorisée côté serveur (AUTH-INV-011).
   *
   * `role` vaut `null` quand l'appelant n'en tient aucun — invité mais pas
   * encore habilité, ou session plateforme sans rôle plateforme. À lire comme
   * « aucune autorité particulière », **jamais** comme « pas encore chargé » :
   * l'état de chargement est porté par TanStack Query, pas par cette valeur.
   *
   * La portée suit la session : organisation active si elle en a une, plateforme
   * sinon. Jamais l'union des deux.
   */
  role: Role | null;
  permissions: string[];
};

/**
 * Ce que `POST /auth/sessions` renvoie — **pas** un `CurrentUser`.
 *
 * Aucun jeton dans le corps : ils vivent dans des cookies `HttpOnly`, jamais
 * lisibles depuis JavaScript (AUTH-INV-001).
 */
export type SessionCreated = {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  /** Vrai quand l'utilisateur appartient à plusieurs organisations. */
  requiresOrganizationSelection: boolean;
  expiresAt: string;
};

export type LoginInput = {
  email: string;
  password: string;
};
