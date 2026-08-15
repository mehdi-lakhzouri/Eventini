import type { TenantContext } from '../../../common/types/tenant-context';

/** Une invitation telle que l'écran d'administration la voit. */
export interface InvitationSummary {
  readonly invitationId: string;
  readonly email: string;
  readonly status: string;
  readonly roleCode: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly acceptedAt: Date | null;
}

export interface CreateInvitationCommand {
  readonly email: string;
  readonly normalizedEmail: string;
  readonly roleId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly invitedBy: string;
}

/** Ce qu'une invitation valide permet de faire, une fois le jeton reconnu. */
export interface PendingInvitation {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly normalizedEmail: string;
  readonly email: string;
  readonly roleId: string;
  readonly expiresAt: Date;
  /** L'utilisateur existant portant cette adresse, s'il y en a un. */
  readonly existingUserId: string | null;
}

export type InvitationRefusal =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ALREADY_USED'
  /** L'appelant est connecté sous une autre adresse que l'invitée. */
  | 'SESSION_MISMATCH'
  /** Un membership vivant existe déjà pour ce couple utilisateur/organisation. */
  | 'ALREADY_MEMBER'
  /** Compte à créer, mais aucun mot de passe fourni. */
  | 'PASSWORD_REQUIRED';

export interface AcceptedInvitation {
  readonly userId: string;
  readonly organizationId: string;
  readonly membershipId: string;
}

/** Un rôle assignable par un administrateur d'organisation. */
export interface AssignableRole {
  readonly roleId: string;
  readonly code: string;
}

export abstract class InvitationRepository {
  /**
   * Le rôle nommé, **s'il est de portée `ORGANIZATION`**.
   *
   * 🔴 Le filtre de portée est la première des trois défenses contre l'escalade
   * la plus directe que ce schéma autorise : inviter quelqu'un avec un rôle
   * `PLATFORM` depuis l'API d'organisation. Le trigger INV-09 la refuse aussi
   * en base — les deux, parce qu'une vérification applicative seule est une
   * vérification qu'un futur chemin d'écriture peut contourner sans le savoir.
   *
   * Rendre `null` plutôt que le rôle hors portée : l'appelant ne doit pas
   * pouvoir distinguer « ce rôle n'existe pas » de « ce rôle existe mais vous
   * n'y avez pas droit », sans quoi la route énumère le catalogue plateforme.
   */
  abstract findAssignableRole(code: string): Promise<AssignableRole | null>;

  /**
   * Crée l'invitation et bascule en `REPLACED` les `PENDING` de la même
   * adresse dans la même organisation.
   *
   * Les deux dans **une seule** transaction : sans cela, deux invitations
   * `PENDING` coexistent pour une même adresse le temps d'un échec partiel, et
   * la seconde acceptation trouverait deux lignes valides — dont une avec un
   * rôle que l'invitant croyait avoir remplacé.
   */
  abstract create(
    context: TenantContext,
    command: CreateInvitationCommand,
  ): Promise<InvitationSummary>;

  abstract listForOrganization(
    context: TenantContext,
  ): Promise<InvitationSummary[]>;

  /**
   * Révoque une invitation en attente. Rend `false` si elle n'existe pas dans
   * cette organisation, ou n'est plus en attente.
   *
   * `REVOKED`, jamais `DELETE` : une invitation retirée reste une trace de ce
   * qui a été tenté, et la table est append-only par convention (§9).
   */
  abstract revoke(
    context: TenantContext,
    invitationId: string,
    actorId: string,
  ): Promise<boolean>;

  /**
   * Retrouve une invitation par l'empreinte de son jeton.
   *
   * Non scopée par construction : l'acceptation précède toute session, donc il
   * n'existe aucun contexte tenant à filtrer dessus. Ce qui la rend sûre est
   * que l'empreinte est le seul critère — un appelant ne choisit pas quelle
   * organisation il interroge, il présente un secret qui en désigne une.
   */
  abstract findByTokenHash(
    tokenHash: string,
  ): Promise<PendingInvitation | null>;

  /**
   * Consomme l'invitation : utilisateur créé ou associé, membership `ACTIVE`,
   * rôle assigné, invitation `ACCEPTED`.
   *
   * 🔴 **Une seule transaction.** Un membership sans rôle, ou un utilisateur
   * créé sans membership, sont des états incohérents que rien en aval ne
   * rattrape : le premier donne un accès sans droits, le second un compte
   * orphelin qui ne peut ni se connecter utilement ni être réinvité, puisque
   * son adresse est désormais prise.
   */
  abstract accept(input: {
    readonly invitation: PendingInvitation;
    readonly passwordHash: string | null;
  }): Promise<AcceptedInvitation | InvitationRefusal>;
}
