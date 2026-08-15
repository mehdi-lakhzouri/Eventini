import type { TenantContext } from '../../../common/types/tenant-context';

/**
 * Un membre, tel que l'écran d'administration a le droit de le voir.
 *
 * 🔴 La liste des champs est la sécurité de cette route. Le ticket l'exige :
 * « le résultat n'expose que les données nécessaires — pas de hash, pas de
 * secret MFA, pas d'adresse IP de session ». Un présenteur explicite plutôt
 * qu'un `select *`, parce qu'un `select *` gagne silencieusement chaque colonne
 * qu'une migration future ajoutera.
 *
 * `mfaEnabled` est un booléen et non le détail des méthodes : savoir qu'un
 * administrateur a activé le second facteur est utile à qui gère une
 * organisation, savoir *laquelle* ne l'est pas.
 */
export interface MemberSummary {
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly status: string;
  readonly mfaEnabled: boolean;
  readonly joinedAt: Date | null;
  readonly roleCodes: readonly string[];
}

export type RoleChangeRefusal =
  /** Le membership n'existe pas dans cette organisation. */
  | 'NOT_FOUND'
  /**
   * Un code de rôle inconnu, **ou** de portée autre qu'`ORGANIZATION`.
   *
   * Les deux se répondent à l'identique : distinguer dirait à un administrateur
   * d'organisation quels rôles plateforme existent.
   */
  | 'UNKNOWN_ROLE'
  /**
   * L'appelant vise son propre membership.
   *
   * Refusé quel que soit le changement demandé : s'ajouter un rôle est une
   * élévation de privilège en une requête, par quelqu'un qui a déjà le droit
   * d'en accorder aux autres — et se retirer le sien est un verrouillage sans
   * recours.
   */
  | 'SELF_ASSIGNMENT';

export interface RoleChangeOutcome {
  readonly membershipId: string;
  readonly previousRoleCodes: readonly string[];
  readonly roleCodes: readonly string[];
}

export abstract class MemberRepository {
  abstract listMembers(context: TenantContext): Promise<MemberSummary[]>;

  /**
   * Remplace l'ensemble des rôles d'un membership — sémantique `PUT`.
   *
   * Le corps porte l'état **voulu**, pas un delta. Un delta obligerait le
   * client à connaître l'état courant pour le décrire, et deux administrateurs
   * envoyant chacun leur delta produiraient une union que ni l'un ni l'autre
   * n'a demandée.
   *
   * ## 🔴 Ce que la transaction doit contenir
   *
   * ```
   * révocation des rôles retirés     (revoked_at, jamais DELETE)
   *   + insertion des rôles ajoutés
   *   + incrément de permissionsVersion
   *   + entrée d'audit
   * ```
   *
   * L'incrément **dans** la transaction est ce qui rend la révocation
   * immédiate. Hors d'elle, un lecteur peut observer les nouvelles lignes sous
   * l'ancienne version et les mettre en cache : des permissions périmées
   * jusqu'au TTL, c'est-à-dire un rôle révoqué qui continue d'autoriser.
   *
   * Le compteur vit dans Redis, donc il n'est pas *transactionnel* avec
   * PostgreSQL. L'ordre choisi rend l'échec inoffensif : l'incrément précède le
   * commit, si bien qu'un rollback laisse une version avancée pour rien — un
   * cache manqué, une relecture en base, rien de plus. L'ordre inverse
   * laisserait un changement commité avec un cache périmé, ce qui est la
   * faille.
   */
  abstract replaceRoles(
    context: TenantContext,
    input: {
      readonly membershipId: string;
      readonly roleCodes: readonly string[];
      readonly actorRole: string | null;
      readonly requestId: string | null;
      readonly ipAddress: string | null;
    },
  ): Promise<RoleChangeOutcome | RoleChangeRefusal>;
}
