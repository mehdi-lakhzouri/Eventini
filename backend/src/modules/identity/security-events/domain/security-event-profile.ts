import type {
  SecurityEventResult,
  SecurityEventSeverity,
  SecurityEventType,
} from '../../../../infrastructure/database/enums';

export interface SecurityEventProfile {
  readonly severity: SecurityEventSeverity;
  readonly result: SecurityEventResult;
}

/**
 * La gravité et l'issue de chaque type d'événement — EVT-077.
 *
 * ## 🔴 Pourquoi ce n'est pas l'appelant qui les choisit
 *
 * `severity` n'a de valeur que comparée : la seule question qu'on pose à cette
 * colonne est « montre-moi tout ce qui est `HIGH` ou au-dessus depuis une
 * heure ». Si chaque site d'émission décidait la sienne, deux personnes
 * classeraient le même fait différemment et la requête cesserait de vouloir
 * dire quoi que ce soit — sans que rien ne casse, ce qui est le pire des cas.
 *
 * `result` est fixe pour la même raison, et pour une deuxième : le catalogue
 * nomme déjà l'issue. `LOGIN_SUCCEEDED` et `LOGIN_FAILED` sont deux types,
 * pas un type et un champ. Laisser passer un `LOGIN_SUCCEEDED` en `FAILURE`
 * rendrait la table contradictoire avec elle-même.
 *
 * Conséquence assumée : si un cas réclame une autre issue, ce n'est pas le
 * même événement — c'est une entrée à ajouter ici, sous revue, plutôt qu'un
 * paramètre à passer depuis un endroit que personne ne relira.
 *
 * `DENIED` est distinct de `FAILURE` (`enums.ts`) : un échec est une tentative
 * qui n'a pas marché, un refus est une tentative écartée par la politique.
 */
export const SECURITY_EVENT_PROFILES: Readonly<
  Record<SecurityEventType, SecurityEventProfile>
> = {
  // --- Authentification ----------------------------------------------------
  LOGIN_SUCCEEDED: { severity: 'INFO', result: 'SUCCESS' },
  /*
    `LOW`, et pas plus : un mot de passe raté est le bruit de fond d'Internet.
    Ce qui mérite l'attention n'est pas l'échec isolé mais son accumulation,
    que le compteur d'échecs porte déjà et qui ressort en `ACCOUNT_LOCKED`.
  */
  LOGIN_FAILED: { severity: 'LOW', result: 'FAILURE' },
  ACCOUNT_LOCKED: { severity: 'MEDIUM', result: 'DENIED' },

  // --- MFA -----------------------------------------------------------------
  MFA_CHALLENGE_CREATED: { severity: 'INFO', result: 'SUCCESS' },
  MFA_SUCCEEDED: { severity: 'INFO', result: 'SUCCESS' },
  /*
    Au-dessus de `LOGIN_FAILED`, et ce n'est pas une nuance : pour arriver
    jusqu'au second facteur, il a fallu passer le premier. Un `MFA_FAILED`
    dit qu'un mot de passe correct a été présenté par quelqu'un qui n'a pas
    le téléphone.
  */
  MFA_FAILED: { severity: 'MEDIUM', result: 'FAILURE' },
  MFA_ENABLED: { severity: 'INFO', result: 'SUCCESS' },
  /*
    `HIGH` sur un succès, ce qui surprend. Retirer un facteur est un
    affaiblissement volontaire du compte, et c'est une étape classique d'une
    prise de contrôle : l'attaquant qui a le mot de passe désactive la MFA
    avant que le propriétaire ne s'en aperçoive.
  */
  MFA_DISABLED: { severity: 'HIGH', result: 'SUCCESS' },

  // --- Sessions ------------------------------------------------------------
  SESSION_CREATED: { severity: 'INFO', result: 'SUCCESS' },
  SESSION_REFRESHED: { severity: 'INFO', result: 'SUCCESS' },
  SESSION_REVOKED: { severity: 'INFO', result: 'SUCCESS' },
  ALL_SESSIONS_REVOKED: { severity: 'MEDIUM', result: 'SUCCESS' },
  /*
    Les deux seuls `CRITICAL` du domaine identité. Un jeton de rafraîchissement
    rejoué signifie qu'il en existe une copie : soit le vol a eu lieu, soit il
    va avoir lieu. §5.3 fait tomber toute la famille sur ce constat, parce que
    savoir laquelle des deux branches est légitime est impossible.
  */
  REFRESH_TOKEN_REUSE_DETECTED: { severity: 'CRITICAL', result: 'DENIED' },
  SESSION_COMPROMISED: { severity: 'CRITICAL', result: 'DENIED' },

  // --- Mots de passe -------------------------------------------------------
  PASSWORD_CHANGED: { severity: 'MEDIUM', result: 'SUCCESS' },
  PASSWORD_RESET_REQUESTED: { severity: 'LOW', result: 'SUCCESS' },
  PASSWORD_RESET_COMPLETED: { severity: 'MEDIUM', result: 'SUCCESS' },

  // --- Autorisation --------------------------------------------------------
  ROLE_CHANGED: { severity: 'MEDIUM', result: 'SUCCESS' },
  ROLE_ESCALATION_ATTEMPTED: { severity: 'HIGH', result: 'DENIED' },
  MEMBERSHIP_REVOKED: { severity: 'MEDIUM', result: 'SUCCESS' },
  /*
    Une requête scopée sur une organisation à laquelle l'appelant n'appartient
    pas n'arrive pas par accident : l'identifiant a dû être deviné ou repris
    ailleurs. C'est le signal de tentative de traversée de tenant.
  */
  TENANT_ACCESS_DENIED: { severity: 'HIGH', result: 'DENIED' },
  /*
    Un refus parfaitement normal — l'étape qui demande à quelqu'un de ressaisir
    son mot de passe avant une opération sensible. `INFO` : c'est la mécanique
    qui fonctionne, pas un incident.
  */
  REAUTHENTICATION_REQUIRED: { severity: 'INFO', result: 'DENIED' },

  // --- Web -----------------------------------------------------------------
  CSRF_VALIDATION_FAILED: { severity: 'MEDIUM', result: 'DENIED' },
  ORIGIN_VALIDATION_FAILED: { severity: 'MEDIUM', result: 'DENIED' },
  RATE_LIMIT_EXCEEDED: { severity: 'LOW', result: 'DENIED' },

  // --- Organisation --------------------------------------------------------
  ORGANIZATION_SUSPENDED: { severity: 'HIGH', result: 'SUCCESS' },
  ORGANIZATION_KILL_SWITCH_EXECUTED: {
    severity: 'CRITICAL',
    result: 'SUCCESS',
  },
  ORGANIZATION_CONTEXT_SWITCHED: { severity: 'INFO', result: 'SUCCESS' },

  // --- Billets et scanners -------------------------------------------------
  TICKET_SIGNATURE_INVALID: { severity: 'HIGH', result: 'DENIED' },
  TICKET_REPLAY_DETECTED: { severity: 'HIGH', result: 'DENIED' },
  SCANNER_DEVICE_REVOKED: { severity: 'MEDIUM', result: 'SUCCESS' },

  // --- Système -------------------------------------------------------------
  IDEMPOTENCY_CONFLICT_DETECTED: { severity: 'LOW', result: 'DENIED' },
  UNSCOPED_QUERY_EXECUTED: { severity: 'MEDIUM', result: 'SUCCESS' },
  SIGNING_KEY_ROTATED: { severity: 'MEDIUM', result: 'SUCCESS' },
};

export function profileFor(type: SecurityEventType): SecurityEventProfile {
  return SECURITY_EVENT_PROFILES[type];
}
