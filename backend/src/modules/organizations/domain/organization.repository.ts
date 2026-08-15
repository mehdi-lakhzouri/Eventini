import type { TenantContext } from '../../../common/types/tenant-context';

/** One organization the caller can actually work in. */
export interface MembershipSummary {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly name: string;
  readonly slug: string;
  /** True when this is the session's current organization. */
  readonly active: boolean;
}

/**
 * Why an activation cannot proceed. The controller renders every one of these
 * as the same `403`: distinguishing "no membership" from "organization
 * suspended" would let a caller enumerate which organization ids exist.
 */
export type ActivationRefusal = 'NO_MEMBERSHIP' | 'ORGANIZATION_UNAVAILABLE';

export interface ActivationTarget {
  readonly organizationId: string;
  readonly membershipId: string;
}

/** Une organisation telle que ses membres ont le droit de la voir. */
export interface OrganizationProfile {
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly licensePlan: string;
  readonly userLimit: number | null;
  readonly eventLimit: number | null;
  readonly isEnabled: boolean;
  /** Le jeton de concurrence optimiste, rendu au client en `ETag`. */
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Ce qu'un administrateur d'organisation peut réellement changer. */
export interface OrganizationChanges {
  readonly name?: string;
  readonly slug?: string;
}

/**
 * Pourquoi une écriture versionnée n'a pas eu lieu.
 *
 * `SLUG_TAKEN` est distinct de `CONFLICT` parce que ce sont deux `409` de
 * causes opposées : l'un dit que quelqu'un d'autre a modifié la ressource,
 * l'autre que la valeur demandée appartient à une autre organisation. Les
 * confondre laisserait un client réessayer indéfiniment une valeur qui ne
 * sera jamais libre.
 */
export type OrganizationWriteFailure =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SLUG_TAKEN'
  /** Corps sans aucun champ modifiable — refusé, jamais appliqué à vide. */
  | 'NO_CHANGES';

export abstract class OrganizationRepository {
  /**
   * Keyed on the user, never on a client-supplied organization id — the list
   * is derived from memberships, so it cannot be made to include an
   * organization the caller has no membership in.
   */
  abstract listForUser(
    userId: string,
    currentOrganizationId: string | null,
  ): Promise<MembershipSummary[]>;

  /**
   * Resolves the membership for an activation, or the reason it is refused.
   *
   * The organization id arrives from the path, and this is the one place it is
   * allowed to: it is used to *look up a membership belonging to the caller*,
   * so a forged id finds nothing rather than scoping a query.
   */
  abstract findActivationTarget(
    userId: string,
    organizationId: string,
  ): Promise<ActivationTarget | ActivationRefusal>;

  /**
   * L'organisation de la session courante.
   *
   * Prend le `TenantContext` bien que ce repository soit exempté de la règle
   * ADR-0003 : l'exemption couvre la liste et l'activation, qui sont
   * structurellement inter-organisations. Une lecture de « mon organisation »
   * ne l'est pas, et la scoper coûte un paramètre.
   */
  abstract findProfile(
    context: TenantContext,
  ): Promise<OrganizationProfile | null>;

  /**
   * Écriture versionnée. Rend le profil à jour, ou la raison du refus.
   *
   * `expectedVersion` fait partie du `WHERE` et non d'une vérification
   * préalable : lire puis écrire laisse une fenêtre entre les deux, et c'est
   * exactement dans cette fenêtre que se produit la perte de mise à jour que
   * ce mécanisme existe pour empêcher.
   */
  abstract updateProfile(
    context: TenantContext,
    expectedVersion: number,
    changes: OrganizationChanges,
    actorId: string,
  ): Promise<OrganizationProfile | OrganizationWriteFailure>;
}
