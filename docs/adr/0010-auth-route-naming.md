# ADR-0010 — Nommage des routes d'authentification

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-2** |
| **Impacte** | tous les controllers d'authentification, le client API frontend, OpenAPI |

## Contexte

Contradiction frontale entre deux baselines :

- **Document B §44** définit `POST /auth/login`, `/auth/mfa/verify`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/password/change`, `/auth/mfa/enroll|confirm|disable`, `/auth/mfa/recovery-codes/regenerate`.
- **Document C §5.1** impose le préfixe `/api/v1` ; **§5.2** impose des noms au pluriel ; **§4.3** préfère explicitement `POST /api/v1/orders/{orderId}/cancellation` à `POST /api/v1/cancelOrder`.

**Chaque** route d'authentification du Document B viole le Document C sur deux points : pas de préfixe de version, et un verbe en segment final.

Le frontend appelle déjà `/identity/authentication/login`, `/identity/mfa/verify`, `/identity/passwords/reset`, `/identity/sessions` — une **quatrième** convention, qui ne correspond à aucun document.

## Décision

**Le Document C l'emporte.** Les routes d'authentification adoptent la forme sous-ressource nominale, sous le préfixe `/api/v1`.

| Opération | Route | Méthode |
|---|---|---|
| Connexion | `/api/v1/auth/sessions` | `POST` |
| Rafraîchissement | `/api/v1/auth/sessions/current/rotation` | `POST` |
| Déconnexion | `/api/v1/auth/sessions/current` | `DELETE` |
| Déconnexion globale | `/api/v1/auth/sessions` | `DELETE` |
| Lister ses sessions | `/api/v1/auth/sessions` | `GET` |
| Révoquer une session | `/api/v1/auth/sessions/{sessionId}` | `DELETE` |
| Utilisateur courant | `/api/v1/auth/me` | `GET` |
| Token CSRF | `/api/v1/auth/csrf-token` | `GET` |
| Vérification MFA | `/api/v1/auth/mfa/challenges/{challengeId}/verification` | `POST` |
| Enrôlement MFA | `/api/v1/auth/mfa/enrollments` | `POST` |
| Confirmation d'enrôlement | `/api/v1/auth/mfa/enrollments/{enrollmentId}/confirmation` | `POST` |
| Désactivation MFA | `/api/v1/auth/mfa/methods/{methodId}` | `DELETE` |
| Régénération recovery codes | `/api/v1/auth/mfa/recovery-codes` | `POST` |
| Demande de reset | `/api/v1/auth/password-reset-requests` | `POST` |
| Application du reset | `/api/v1/auth/password-resets` | `POST` |
| Changement de mot de passe | `/api/v1/auth/password` | `PUT` |
| Acceptation d'invitation | `/api/v1/auth/invitation-acceptances` | `POST` |
| Réauthentification | `/api/v1/auth/reauthentications` | `POST` |
| Changement d'organisation | `/api/v1/organizations/{organizationId}/activation` | `POST` |

**`/auth/me` est l'exception assumée.** `GET /api/v1/auth/sessions/current/user` serait plus rigoureux et illisible. Une exception documentée vaut mieux qu'une règle appliquée sans discernement.

`/api/v1/auth/…` est retenu plutôt que `/api/v1/identity/…` : le préfixe décrit la capacité exposée, `identity` est le nom du module interne et n'a pas à fuiter dans le contrat public.

## Conséquences

**Positives** — une seule convention dans toute l'API ; `POST /auth/sessions` + `DELETE /auth/sessions/current` rend le cycle de vie de session évident dans l'URL ; `DELETE /auth/sessions` (collection) pour la déconnexion globale est cohérent avec la sémantique HTTP.

**Négatives** — `/auth/sessions/current/rotation` est plus long que `/auth/refresh` et moins immédiatement familier ; les 9 fonctions du client API frontend doivent être réécrites (elles pointent aujourd'hui vers des routes qui n'existent d'aucun côté) ; le Document B §44 devient périmé sur ce point, signalé dans son entête.

**C'est la décision de cet ADR la plus discutable.** Si l'ergonomie de lecture prime, revenir à `/api/v1/auth/login` reste défendable — il suffirait alors de documenter une dérogation `SHOULD` au Document C §5.2, comme son §2 l'autorise explicitement.

## Alternatives rejetées

- **Garder `/auth/login`, `/auth/refresh`, `/auth/logout`** — familier, court, universellement compris. Rejeté parce que le Document C impose une règle et prévoit que toute dérogation `SHOULD` soit justifiée par un ADR : cet ADR aurait alors dû justifier pourquoi l'authentification échappe seule à la convention, ce qui est plus faible que de l'appliquer.
- **Conserver `/identity/*` du frontend** — expose la structure interne des modules dans le contrat public.

## Vérification

Test de contrat : aucune route de l'API ne se termine par un segment verbal. Contrôle automatisable sur le document OpenAPI généré.
