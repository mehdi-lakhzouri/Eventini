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
