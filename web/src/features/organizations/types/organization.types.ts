/** Une organisation dans laquelle l'appelant peut réellement travailler. */
export type MembershipSummary = {
  organizationId: string;
  membershipId: string;
  name: string;
  slug: string;
  /** Vrai pour l'organisation courante de la session. */
  active: boolean;
};

/**
 * Ce que renvoie l'activation : une **nouvelle** session, pas une session
 * modifiée.
 *
 * La bascule ne met pas `user_sessions.organization_id` à jour sur place. Elle
 * crée une session et révoque la famille de jetons de la précédente
 * (ADR-0002) : un refresh token capturé avant le changement continuerait sinon
 * de fonctionner après, pointant désormais sur la nouvelle organisation.
 */
export type ActivatedSession = {
  sessionId: string;
  organizationId: string;
  membershipId: string;
  expiresAt: string;
};

/** `GET /organizations/{id}` — la fiche complète, telle que le présenteur la rend. */
export type OrganizationProfile = {
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  licensePlan: string;
  userLimit: number | null;
  eventLimit: number | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * La fiche **et** son `ETag`.
 *
 * Les deux voyagent ensemble parce qu'ils ne valent que l'un par l'autre :
 * l'écriture exige `If-Match`, et un `ETag` séparé de la fiche qu'il version
 * finirait par être celui d'une lecture antérieure.
 */
export type VersionedOrganization = {
  organization: OrganizationProfile;
  etag: string | null;
};

export const MEMBERSHIP_STATUSES = [
  "INVITED",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
  "EXPIRED",
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * `GET /organizations/{id}/members`.
 *
 * Le backend nomme ses colonnes une par une plutôt que de rendre la ligne : ni
 * hash, ni secret MFA, ni adresse IP n'y figurent, et ce type suit exactement
 * ce que ce présenteur rend. L'élargir de mémoire ferait apparaître des champs
 * `undefined` à l'écran.
 */
export type OrganizationMember = {
  membershipId: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  status: MembershipStatus;
  mfaEnabled: boolean;
  joinedAt: string | null;
  roleCodes: string[];
};

export const INVITATION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * `GET /organizations/{id}/invitations`.
 *
 * 🔴 Aucun jeton. Le backend n'en renvoie jamais — il n'en stocke que le HMAC
 * (EVT-043), et le jeton en clair n'existe qu'une fois, dans le lien envoyé par
 * courriel. Un champ `token` ici serait un champ que rien ne peut remplir.
 */
export type Invitation = {
  invitationId: string;
  email: string;
  status: InvitationStatus;
  roleCode: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

/** Ce que rend le remplacement des rôles d'un membre. */
export type RoleChangeResult = {
  membershipId: string;
  previousRoleCodes: string[];
  roleCodes: string[];
};

/** Ce que rend une transition de cycle de vie. */
export type LifecycleResult = {
  membershipId: string;
  previousStatus: MembershipStatus;
  status: MembershipStatus;
  revokedSessions: number;
  revokedEventAssignments: number;
};
