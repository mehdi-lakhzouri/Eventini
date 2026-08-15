import type { TenantContext } from '../../../common/types/tenant-context';

/**
 * Les transitions autorisées d'un membership — EVT-045.
 *
 * ```
 * INVITED   → ACTIVE            (acceptation d'invitation, EVT-043)
 * ACTIVE   ⇄ SUSPENDED          (suspension et réactivation)
 * ACTIVE|SUSPENDED → REVOKED    (départ définitif)
 * INVITED   → EXPIRED           (invitation périmée)
 * ```
 *
 * Ce fichier n'en porte que deux : suspendre/réactiver, et révoquer. Les deux
 * autres appartiennent au cycle de l'invitation, où elles sont déjà écrites.
 */

export type LifecycleRefusal =
  /** Aucun membership de cet identifiant dans cette organisation. */
  | 'NOT_FOUND'
  /**
   * La transition demandée n'existe pas depuis l'état courant.
   *
   * Réactiver un membership `REVOKED`, par exemple : un départ est définitif,
   * et le retour se fait par une nouvelle invitation — ce qui laisse une trace
   * de la décision au lieu de faire réapparaître un accès silencieusement.
   */
  | 'INVALID_TRANSITION'
  /**
   * L'appelant vise son propre membership.
   *
   * Se suspendre ou se révoquer soi-même coupe la session en cours au milieu
   * de l'opération. Plus important : dans une organisation à un seul
   * administrateur, cela la laisse sans personne pour la rouvrir.
   */
  | 'SELF_TARGET';

export interface LifecycleOutcome {
  readonly membershipId: string;
  readonly previousStatus: string;
  readonly status: string;
  /** Combien de sessions ont été coupées. Zéro est un résultat normal. */
  readonly revokedSessions: number;
  readonly revokedEventAssignments: number;
}

export abstract class MembershipLifecycleRepository {
  /**
   * `ACTIVE ⇄ SUSPENDED`.
   *
   * La suspension **ne coupe pas** les sessions. Elle n'en a pas besoin :
   * l'étape 5 de la chaîne d'autorisation lit `membershipStatus` à chaque
   * requête depuis EVT-036, donc un membership suspendu cesse d'autoriser
   * immédiatement, sur le jeton existant. Couper en plus les sessions rendrait
   * la réactivation plus brutale qu'utile — l'intéressé devrait se
   * reconnecter alors que rien ne l'exige.
   */
  abstract setSuspended(
    context: TenantContext,
    input: {
      readonly membershipId: string;
      readonly suspended: boolean;
      readonly reason: string | null;
      readonly actorRole: string | null;
      readonly requestId: string | null;
      readonly ipAddress: string | null;
    },
  ): Promise<LifecycleOutcome | LifecycleRefusal>;

  /**
   * `ACTIVE|SUSPENDED → REVOKED`, avec ses effets en cascade.
   *
   * ## 🔴 Tout dans la même transaction
   *
   * ```
   * membership          → REVOKED
   * user_sessions       → REVOKED   (celles dont active_membership_id pointe ici)
   * event_user_assignments → revoked_at
   * permissionsVersion  → incrémenté
   * audit_logs          → une entrée
   * ```
   *
   * Le scénario que cela ferme : un administrateur quitte l'organisation
   * cliente et conserve ses cookies. L'étape 5 de la chaîne le refuse dès la
   * requête suivante — mais couper les sessions en base est ce qui empêche le
   * refresh token de continuer à en produire de nouvelles, et ce qui rend le
   * départ visible dans la liste des sessions de l'intéressé.
   *
   * Les assignations d'événement sont révoquées avec : elles sont
   * `EVENT`-scopées et survivraient au membership qui les portait, laissant un
   * accès à un événement précis sans plus aucun lien d'appartenance derrière.
   */
  abstract revoke(
    context: TenantContext,
    input: {
      readonly membershipId: string;
      readonly reason: string | null;
      readonly actorRole: string | null;
      readonly requestId: string | null;
      readonly ipAddress: string | null;
    },
  ): Promise<LifecycleOutcome | LifecycleRefusal>;
}
