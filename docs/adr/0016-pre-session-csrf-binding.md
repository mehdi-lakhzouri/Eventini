# ADR-0016 — Liaison CSRF avant l'existence d'une session

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-16**, **C-18** |
| **Impacte** | `CsrfGuard`, `CsrfTokenService`, `GET /auth/csrf-token`, login, reset de mot de passe |
| **Invariants** | AUTH-INV-006, AUTH-INV-007 |

## Contexte

Le Document B se contredit lui-même sur le point le plus sensible du flux :

- **§44.1** classe `GET /auth/csrf` parmi les endpoints **pré-authentification** ;
- **§15.3** impose de valider, dans l'ordre : « 1. cookie d'authentification ; 2. session active ; 3. cookie CSRF ; … 7. liaison à la session » ;
- **§15.4** interdit d'exempter les mutations sensibles, sans jamais lister `POST /auth/login` comme exemptée.

Un `POST` de login n'a par définition **ni cookie d'authentification, ni session active**. Les étapes 1, 2 et 7 ne peuvent pas passer. Tel qu'écrit, le login est soit non protégé, soit impossible.

Ce n'est pas théorique : sans protection CSRF sur le login, un attaquant peut réaliser un **login CSRF** — forcer la victime à s'authentifier sur un compte contrôlé par l'attaquant, puis observer l'activité qu'elle y produit.

## Décision

**Deux modes de liaison du token CSRF, selon qu'une session existe ou non.**

### Mode pré-session

`GET /api/v1/auth/csrf-token` sans session authentifiée :

1. Génère un identifiant de contexte anonyme, posé dans un cookie `__Host-eventini_csrf_ctx` — `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, durée 30 min.
2. Émet un token CSRF signé, lié à **cet identifiant de contexte**, exposé dans le cookie lisible `eventini_csrf` et attendu dans le header `X-CSRF-Token`.
3. Le guard valide : présence des deux, égalité, signature, liaison au contexte anonyme, méthode mutante, `Origin`.

### Mode session

Après authentification, le token CSRF est régénéré et lié au `sessionId` réel. Le cookie de contexte anonyme est supprimé lors de l'émission des cookies de session.

### Rebinding au login

`POST /auth/sessions` valide d'abord le CSRF en **mode pré-session**, puis, en cas de succès, émet un nouveau token CSRF lié à la session créée. Cela rompt toute continuité entre le token pré-session et le token de session — un token pré-session capturé ne survit pas au login.

### Cohérence des préfixes de cookies

Le Document B utilise trois conventions différentes pour trois cookies du même sous-système (C-18). Règle retenue :

| Cookie | Nom | Justification |
|---|---|---|
| Access | `__Host-eventini_access` | `Path=/`, pas de `Domain` — `__Host-` applicable |
| Refresh | `__Secure-eventini_refresh` | `Path` restreint à la route de rotation ⇒ `__Host-` impossible |
| Contexte CSRF | `__Host-eventini_csrf_ctx` | `Path=/`, `HttpOnly` |
| CSRF lisible | `eventini_csrf` | **doit** être lisible par JavaScript, donc pas `HttpOnly` ; `__Host-` reste applicable et est **ajouté** : `__Host-eventini_csrf` |

Le `Path` du cookie refresh, jamais nommé dans le Document B (C-17), est fixé à **`/api/v1/auth/sessions`**, ce qui couvre la rotation et la déconnexion sans exposer le refresh token au reste de l'API.

La suppression de cookie rejoue **nom, `Path`, `Domain`, `SameSite`, `Secure` et `HttpOnly`** — le Document B §14.4 omettait `HttpOnly` (C-19).

### Exemptions

Exempts de CSRF, et uniquement ceux-là : `/health/*`, `/metrics`, les endpoints mobiles porteurs d'un `Authorization: Bearer` **sans cookie**. Toute route acceptant un cookie d'authentification est protégée, sans exception.

## Conséquences

**Positives** — le login est réellement protégé ; le flux est implémentable tel que documenté, ce qui n'était pas le cas ; le rebinding empêche la fixation de token CSRF ; les préfixes de cookies deviennent cohérents et justifiés.

**Négatives** — un cookie et un état supplémentaires avant authentification ; le frontend doit appeler `GET /auth/csrf-token` avant d'afficher le formulaire de login, ce qui ajoute un aller-retour au premier chargement.

## Alternatives rejetées

- **Exempter le login de CSRF** — le plus simple, et c'est ce que la lecture littérale du Document B produit. Rejeté : laisse la porte ouverte au login CSRF.
- **`SameSite=Strict` seul, sans token** — bloque la plupart des attaques CSRF sur les navigateurs récents, mais dégrade les retours de lien externe et ne constitue pas une défense en profondeur.

## Vérification

- Test e2e négatif : `POST /auth/sessions` sans header `X-CSRF-Token` ⇒ `403 AUTH_CSRF_INVALID`.
- Test e2e négatif : token CSRF valide mais lié à un autre contexte ⇒ `403`.
- Test e2e : le token CSRF émis avant le login n'est plus accepté après le login.
