# Sprint 08 — Organisations

> [← Sprint 07](../sprint-07/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 09 →](../sprint-09/README.md)

| | |
|---|---|
| **Tickets** | EVT-042 → EVT-047 · **EVT-032** (reporté du sprint 05) |
| **Prérequis** | Sprint 06 (et 07 pour l'UI) |
| **Migrations** | aucune |
| **Parallélisable avec** | Sprint 07 |

---

## Objectif

Un client gère son organisation, ses membres et leurs droits.

Premier sprint de features métier. Il hérite gratuitement de l'isolation et de l'autorisation du jalon M2.

## Critère de sortie

Un utilisateur membre de **deux organisations** bascule de contexte ; ses permissions changent **immédiatement** ; sa session est rotée.

---

## Tickets

| # | Titre | Permission |
|---|---|---|
| [EVT-042](#evt-042) | CRUD organisation contrôlé ✅ | `organizations.read` / `.manage` |
| [EVT-043](#evt-043) | Invitations | `users.invite` |
| [EVT-044](#evt-044) | Membres et assignation de rôles | `users.read` / `users.manage_roles` |
| [EVT-045](#evt-045) | Suspension et révocation de membership | `users.manage_roles` |
| [EVT-046](#evt-046) | UI d'administration d'organisation | — |
| [EVT-047](#evt-047) | i18n complet | — |
| [EVT-032](#evt-032) | Concurrence optimiste — `ETag` / `If-Match` ✅ | — |

---

## EVT-042 — CRUD organisation contrôlé
<a id="evt-042"></a>

```
Branche  feat/EVT-042-organization-crud
Routes   GET /organizations · GET|PATCH /organizations/{organizationId}
Tables   organizations
```

> ✅ **Fait le 14 août 2026, avec [EVT-032](#evt-032).** 1076 tests unitaires, 216 e2e, 29 architecture.
>
> **Décision produit** — le `slug` **est** modifiable. Conséquence assumée : tout lien portant l'ancien casse, aucune redirection n'étant conservée faute de table d'historique. Le format est contraint (minuscules, chiffres, tirets simples, 3 à 63 caractères) et quinze segments sont réservés — sans quoi une organisation nommée `api` ou `admin` rendrait ambiguë toute URL de la forme `/{slug}/…`, et l'ambiguïté se résoudrait en sa faveur.
>
> **La collision de slug est un `409` distinct du conflit de version.** Deux `409` de causes opposées : l'un dit que quelqu'un est passé avant vous, l'autre que la valeur demandée est prise pour toujours. Les confondre laisserait un client réessayer indéfiniment. Le refus **ne nomme pas** l'organisation propriétaire — l'index est global aux organisations vivantes, et la nommer ferait de cette route un moyen d'énumérer la plateforme.
>
> **Un corps vide est refusé.** Accepté, il incrémenterait la version et invaliderait l'`ETag` de tous les autres lecteurs pour un changement qui n'a pas eu lieu.
>
> **L'audit n'est pas écrit par ce ticket** — `src/modules/audit/` est une souche vide, et le module sera construit avec [EVT-044](#evt-044), où le ticket l'impose « dans la même transaction ». Décision assumée : un renommage ne laisse donc aucune trace d'ici là.

`GET /organizations` liste les organisations **où l'appelant a un membership actif** — jamais toutes. `PATCH` exige `If-Match` (verrou optimiste).

**Champs non modifiables par l'API** — `status`, `is_enabled`, `license_plan`, `user_limit`, `event_limit`. Ce sont des attributs plateforme, modifiables uniquement par `platform.organizations.manage`. Une écriture les ciblant est rejetée par `forbidNonWhitelisted`.

---

## EVT-043 — Invitations
<a id="evt-043"></a>

```
Branche  feat/EVT-043-invitations
Routes   POST|GET /organizations/{organizationId}/invitations
         DELETE   /organizations/{organizationId}/invitations/{invitationId}
         POST     /auth/invitation-acceptances
Tables   user_invitations, organization_memberships, users
```

**Flux** — vérification tenant + permission + doublon → invitation à durée limitée (**7 j**) → token généré de façon sécurisée et **stocké haché** → email mis en file BullMQ → acceptation → utilisateur créé ou associé → membership `ACTIVE` → rôle assigné → audit.

**Sécurité**

| Règle | |
|---|---|
| Token **haché** en base, jamais en clair | `ux_invitation_token_hash` |
| Réponse identique que l'email existe déjà ou non | anti-énumération |
| Toute nouvelle invitation passe les `PENDING` du même email en `REPLACED` | |
| Rate limit `10 / h` par IP sur l'acceptation | forçage de token |
| Un `CLIENT_ADMIN` ne peut inviter qu'avec des rôles de portée `ORGANIZATION` | INV-09 |

**Transaction** — création de l'utilisateur, du membership et de l'assignation de rôle dans **une seule** transaction. Un membership sans rôle, ou l'inverse, est un état incohérent.

---

## EVT-044 — Membres et assignation de rôles
<a id="evt-044"></a>

```
Branche  feat/EVT-044-members-and-roles
Routes   GET /organizations/{organizationId}/members
         PUT /organizations/{organizationId}/members/{membershipId}/roles
Tables   organization_memberships, membership_role_assignments
```

### Effets obligatoires, même transaction

```
assignation ou révocation de rôle
  → membership_role_assignments mis à jour (revoke, jamais delete)
  → permissionsVersion INCRÉMENTÉ
  → audit_logs
  → security_events: ROLE_CHANGED
```

L'incrément de `permissionsVersion` **dans la transaction** est ce qui rend la révocation immédiate. Hors transaction, un échec partiel laisserait des permissions périmées jusqu'au TTL du cache.

### 🔴 Trois escalades à bloquer

| Attaque | Défense |
|---|---|
| Assigner un rôle de portée `PLATFORM` via l'API d'organisation | refus applicatif **et trigger** (INV-09) |
| Révoquer le dernier `SUPER_ADMIN` actif | trigger (INV-10) |
| Assigner `SUPER_ADMIN` à un compte sans MFA actif | refus (INV-11) |

Ces trois vérifications ne dépendent **pas du seul code applicatif** : ce sont les voies les plus directes d'une élévation de privilège.

**Membres listés** — le résultat n'expose que les données nécessaires : pas de hash, pas de secret MFA, pas d'adresse IP de session.

---

## EVT-045 — Suspension et révocation de membership
<a id="evt-045"></a>

```
Branche  feat/EVT-045-membership-lifecycle
Routes   POST   /organizations/{organizationId}/members/{membershipId}/suspension
         DELETE /organizations/{organizationId}/members/{membershipId}
```

**Transitions** — `INVITED → ACTIVE`, `ACTIVE ⇄ SUSPENDED`, `ACTIVE|SUSPENDED → REVOKED`, `INVITED → EXPIRED`.

### Effets d'une révocation, même transaction

```
membership → REVOKED
  → révoquer les user_sessions dont active_membership_id pointe ici
  → révoquer les event_user_assignments
  → incrémenter permissionsVersion
  → security_events: MEMBERSHIP_REVOKED
  → audit_logs
```

**Scénario métier** — un administrateur quitte l'organisation cliente et conserve ses cookies. L'étape 5 de la chaîne d'autorisation échoue immédiatement, sans attendre l'expiration de l'access token.

**Test** — révoquer un membership, puis appeler une route de cette organisation avec le token existant ⇒ `403`.

---

## EVT-046 — UI d'administration d'organisation
<a id="evt-046"></a>

```
Branche  feat/EVT-046-organization-ui
```

**Scope** — liste et détail d'organisation, table des membres (TanStack Table), formulaire d'invitation, sélecteur de rôle, actions de suspension et révocation avec confirmation.

**Rappel** — masquer un bouton n'est **pas** une autorisation. Le backend refuse de toute façon. `hasPermission` sert uniquement à ne pas afficher une action qui échouerait.

**Filtres et pagination en URL** via `nuqs` (installé, inutilisé) : partageables et rechargeables.

---

## EVT-047 — i18n complet
<a id="evt-047"></a>

```
Branche  feat/EVT-047-i18n
Commit   feat(web): configure next-intl with fr and en locales
```

**État actuel (F-9)** — `next-intl` est installé avec un wrapper de 10 lignes : `messages={{}}`, **aucun `locale`**, aucun fichier de traduction, aucun plugin dans `next.config.ts` (qui est un objet vide), **zéro `useTranslations`** dans tout le dépôt.

```
web/next.config.ts     → createNextIntlPlugin('./src/i18n/request.ts')
web/src/i18n/routing.ts  locales: ['fr', 'en'], defaultLocale: 'fr'
web/src/i18n/request.ts
web/messages/fr.json · en.json
```

**Stratégie** — préfixe de locale sur les routes non par défaut (`/en/dashboard`, `/dashboard` pour le français). `users.locale` porte la préférence de l'utilisateur connecté.

**Ce qui n'est jamais traduit** — les codes d'erreur (`AUTH_TENANT_DENIED`), les event codes, les noms de permissions. Ce sont des identifiants, pas du texte. Seuls les **messages** le sont.

---

## EVT-032 — Concurrence optimiste (reporté du sprint 05)
<a id="evt-032"></a>

```
Branche  feat/EVT-032-optimistic-concurrency
Commit   feat(api): add optimistic concurrency with ETag and If-Match
```

**Pourquoi ici et pas au sprint 05** — le ticket exige `If-Match` sur des ressources qui, au sprint 05, n'avaient **aucun contrôleur**. Le mécanisme aurait été livré sans appelant et sans test e2e possible. [EVT-042](#evt-042) crée `PATCH /organizations/{organizationId}` : c'est le premier consommateur réel, et il arrive dans ce sprint.

**À implémenter avec EVT-042, pas après** — une route de mutation livrée sans `If-Match` est une route qu'il faudra reprendre, et entre-temps deux administrateurs qui éditent la même organisation s'écrasent silencieusement.

```sql
UPDATE organizations SET name = $1, version = version + 1
WHERE id = $2 AND organization_id = $3 AND version = $4;
-- 0 ligne affectée ⇒ 409 VERSION_CONFLICT
```

Le filtre `organization_id` est présent **même avec un `id` de clé primaire** : c'est la règle de la garde Prisma, sans exception pour les lectures par identifiant.

**Obligatoire sur** — `organizations` et `organization_memberships` dès ce sprint. `events` et `event_sessions` au sprint 09, `participants` et `registrations` au sprint 10, à mesure que leurs contrôleurs apparaissent.

`If-Match` absent ⇒ **`428 PRECONDITION_REQUIRED`**. Délibérément strict : sur une organisation éditée simultanément par deux administrateurs, une écriture aveugle écrase silencieusement le travail de l'autre.

**Les colonnes `version` existent déjà** sur les quatre tables — le report n'a coûté aucune migration.

**Tests** — sans `If-Match` ⇒ `428` · `If-Match` périmé ⇒ `412` · deux `PATCH` concurrents ⇒ un `409`.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| `permissionsVersion` incrémenté hors transaction | Test : révocation ⇒ `403` immédiat |
| Sessions non révoquées à la révocation de membership | Test e2e dédié |
| Escalade `PLATFORM` via l'API d'organisation | Trigger INV-09 + test |
| Le dernier `SUPER_ADMIN` révoqué par erreur | Trigger INV-10 + alerte « aucun SUPER_ADMIN actif » |
| Le listing de membres expose trop de champs | Présenteurs de sortie explicites, pas de `select *` |
| Codes d'erreur traduits par erreur | Seuls les messages le sont |
