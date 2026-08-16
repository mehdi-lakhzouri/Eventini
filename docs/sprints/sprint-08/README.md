# Sprint 08 — Organisations

> [← Sprint 07](../sprint-07/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 09 →](../sprint-09/README.md)

| | |
|---|---|
| **Tickets** | EVT-042 → EVT-047 · **EVT-032** (reporté du sprint 05) · **EVT-076**, **EVT-077** (socles nés du sprint) |
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
| [EVT-043](#evt-043) | Invitations ✅ | `users.invite` |
| [EVT-044](#evt-044) | Membres et assignation de rôles ✅ | `users.read` / `users.manage_roles` |
| [EVT-045](#evt-045) | Suspension et révocation de membership ✅ | `users.manage_roles` |
| [EVT-046](#evt-046) | UI d'administration d'organisation | — |
| [EVT-047](#evt-047) | i18n complet | — |
| [EVT-032](#evt-032) | Concurrence optimiste — `ETag` / `If-Match` ✅ | — |
| [EVT-076](#evt-076) | Journal d'audit métier ✅ | — |
| [EVT-077](#evt-077) | Journal des événements de sécurité ✅ | — |

Les deux derniers ne figuraient pas au plan initial. Ils en sont sortis : quatre tickets du sprint exigeaient une entrée d'audit, et huit tickets du corpus annonçaient écrire dans `security_events` — une table qui n'avait **aucun écrivain** dans tout le dépôt. Les livrer séparément les rend relisibles isolément plutôt que noyés dans l'assignation de rôles.

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

> ✅ **Fait le 14 août 2026.** 1076 tests unitaires, 232 e2e dont 16 sur ce ticket.
>
> ### L'envoi d'email n'est pas dans ce ticket
>
> [EVT-073](../sprint-12/README.md#evt-073) possède explicitement « invitation organisation et utilisateur », et [EVT-065](../sprint-11/README.md#evt-065) construit le premier job BullMQ. Les deux paquets sont installés et inutilisés ; les câbler ici aurait doublé le périmètre et anticipé quatre sprints.
>
> **Décision produit** — en attendant, le jeton est **rendu une seule fois** dans le 201 de création, comme un jeton d'API. `GET` ne le renvoie jamais.
>
> 🔴 **Conséquence assumée** : l'invitant voit le jeton, donc il peut accepter l'invitation à la place de l'invité, depuis n'importe quelle adresse. La possession du jeton cesse de prouver le contrôle de la boîte mail. L'audit d'EVT-044 enregistrera qui a réellement accepté.
>
> ### Session honorée à l'acceptation
>
> Le jeton suffit — accepter une invitation est ce qu'on fait quand on n'a pas encore de compte. Mais **si une session est ouverte, elle doit être celle de l'adresse invitée**. Sans cela, Ana connectée ouvre le lien destiné à Karim et le membership atterrit sur le compte d'Ana, en paraissant avoir fonctionné.
>
> Ne protège pas contre un jeton intercepté utilisé en navigation privée : ce cas exigerait une connexion préalable, écartée pour ne pas imposer un détour à chaque invité.
>
> ### Trois décisions d'anti-énumération
>
> Un rôle `PLATFORM` demandé à l'invitation tombe dans **la même branche** qu'un rôle inexistant — distinguer énumérerait le catalogue plateforme. `NOT_FOUND`, `EXPIRED` et `ALREADY_USED` se répondent **à l'identique** à l'acceptation. Et le rate limit est **par IP, jamais par jeton** : limiter par jeton ne freine rien, puisqu'un attaquant en essaie un nouveau à chaque tentative.
>
> ### L'acceptation n'ouvre pas de session
>
> Émettre une session depuis une route publique contournerait la limitation de débit de la connexion et la porte MFA — cela donnerait à un jeton d'invitation le pouvoir d'un mot de passe. L'invité se connecte ensuite normalement.

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

> ✅ **Fait le 15 août 2026.** 1076 tests unitaires, 245 e2e dont 13 sur ce ticket.
>
> ### 🔴 Un seul rôle est assignable par cette route
>
> Le catalogue seedé ne contient qu'**un** rôle de portée `ORGANIZATION` : `CLIENT_ADMIN`. `EVENT_ADMIN`, `REPORT_VIEWER`, `SCANNER` et `SESSION_MANAGER` sont de portée **`EVENT`** et s'accordent par `event_user_assignments` — une autre table, un autre sprint. `SUPER_ADMIN` est `PLATFORM`.
>
> Le ticket parle d'« assignation de rôles » au pluriel ; en pratique, aujourd'hui, cette route accorde ou retire `CLIENT_ADMIN`. Ce n'est pas un défaut de l'implémentation, c'est ce que le modèle prévoit — mais il valait mieux le constater que le découvrir au sprint 09.
>
> ### Ce qui a été ajouté au-delà du ticket
>
> **On ne modifie pas ses propres rôles.** S'accorder un rôle est une élévation de privilège en une requête, par quelqu'un qui a déjà le droit d'en accorder aux autres ; se retirer le sien est un verrouillage sans recours. Refusé en `403`.
>
> **`security_events` n'a aucun écrivain** — la table est vide, et les trois événements de sécurité du dépôt partent en logs Pino. `ROLE_CHANGED` suit le même chemin ; un ticket dédié construira l'écrivain face à l'ensemble de ses émetteurs. La trace qui fait autorité est `audit_logs`, écrite **dans** la transaction.
>
> ### L'incrément Redis dans une transaction PostgreSQL
>
> Le compteur n'est pas transactionnel avec la base : c'est **l'ordre** qui rend l'échec inoffensif. L'incrément précède le commit, donc un rollback laisse une version avancée pour rien — un cache manqué, une relecture, rien de plus. L'ordre inverse laisserait un changement commité avec un cache périmé, c'est-à-dire un rôle révoqué qui continue d'autoriser jusqu'au TTL.
>
> Un test le prouve de bout en bout : sur le **même jeton d'accès**, un rôle accordé devient effectif immédiatement, et sa révocation aussi.

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

> ✅ **Fait le 15 août 2026.** 259 tests e2e, dont 14 sur ce ticket.
>
> ### 🔴 Le refus est un `401`, pas le `403` annoncé — et c'est plus fort
>
> Le ticket suppose que la session survit et que l'étape 5 la refuse. Mais la révocation **coupe aussi les sessions** : l'étape 2 — la validité de la session elle-même — échoue donc **avant** que l'étape 5 ne soit atteinte. La session n'est pas refusée, elle n'existe plus. Un second test le confirme par l'autre bout : le refresh token ne peut plus produire de nouvelle session.
>
> ### La suspension ne coupe pas les sessions, délibérément
>
> Elle n'en a pas besoin : l'étape 5 lit `membershipStatus` à chaque requête depuis EVT-036, donc un membership suspendu cesse d'autoriser immédiatement sur le jeton existant — vérifié. Couper en plus rendrait la réactivation inutilement brutale, l'intéressé devant se reconnecter alors que rien ne l'exige. Un test vérifie qu'après réactivation, **le même cookie** fonctionne à nouveau.
>
> ### Deux règles ajoutées au-delà du ticket
>
> **On ne se suspend ni ne se révoque soi-même.** Couper sa propre session en cours d'opération est le moindre problème ; le vrai est qu'une organisation à un seul administrateur se retrouverait sans personne pour la rouvrir — et la réactivation exige justement le droit qu'on vient de se retirer.
>
> **Un départ est définitif.** Réactiver un membership `REVOKED` est refusé en `409` : le retour passe par une nouvelle invitation, ce qui laisse une trace de la décision au lieu de faire réapparaître un accès silencieusement.
>
> Le statut attendu est dans le `WHERE` de chaque écriture : deux suspensions concurrentes n'en appliquent qu'une, et c'est la base qui arbitre.

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

## EVT-076 — Journal d'audit métier
<a id="evt-076"></a>

```
Branche  feat/EVT-076-audit-log
Commit   feat(audit): add the business audit log writer
```

**Pourquoi un ticket à part** — EVT-042, EVT-043, EVT-044 et EVT-045 exigent tous une entrée dans `audit_logs`. Le construire dans l'un des quatre l'aurait dessiné pour un seul cas.

**La règle qui porte tout** — `AuditLogRepository.record(tx, entry)` prend la transaction de l'appelant **en premier paramètre, obligatoire**. Le repository n'injecte donc aucun client Prisma : il n'en a pas besoin, et en avoir un ouvrirait la porte à une écriture hors transaction. Un changement commité sans sa trace est le pire des deux états — plus rien ne dit qu'il a eu lieu.

> ✅ **Fait le 15 août 2026.** Écrit par les quatre tickets qui l'ont motivé.

---

## EVT-077 — Journal des événements de sécurité
<a id="evt-077"></a>

```
Branche  feat/EVT-077-security-events
Commit   feat(security): add the security event writer
```

**Le constat qui l'a déclenché** — le module `identity/security-events` existait en **squelette vide** depuis le sprint 02, déjà importé par `AuthenticationModule` et `IdentityModule`. Huit tickets du corpus annoncent écrire dans `security_events` ; la table n'avait aucun écrivain nulle part, et les événements partaient en logs Pino.

### 🔴 L'exact inverse de l'audit, et la symétrie est le piège

| | `audit_logs` | `security_events` |
|---|---|---|
| Transaction de l'appelant | **obligatoire**, premier paramètre | **jamais** |
| Écrit depuis | un repository, **dans** la transaction | un use case, **après** le commit |
| En cas de rollback | disparaît, et c'est voulu | survit, et c'est voulu |

Les deux se ressemblent assez pour qu'on place le second comme le premier. Or les événements qui comptent le plus — `LOGIN_FAILED`, `TENANT_ACCESS_DENIED`, `ROLE_ESCALATION_ATTEMPTED` — sont émis **quand rien n'est commité**. Dans la transaction de l'appelant, la table serait vide exactement des lignes pour lesquelles elle existe.

Symétriquement, un succès émis **avant** le commit affirmerait un changement qui peut encore échouer. D'où la règle de placement, tenue par `__architecture__/security-event-emission.spec.ts` : aucun repository n'atteint `SecurityEventRecorder`, aucun use case n'atteint `AuditRecorder`.

### Ce que l'écrivain décide à la place de l'appelant

**La gravité et l'issue viennent du type, pas du site d'émission.** `severity` n'a de valeur que comparée : la seule question posée à cette colonne est « tout ce qui est `HIGH` ou au-dessus depuis une heure ». Si chaque appelant choisissait la sienne, deux personnes classeraient le même fait différemment et la requête cesserait de vouloir dire quoi que ce soit — sans que rien ne casse. Les 33 profils sont dans `domain/security-event-profile.ts`.

**Le recorder ne relance jamais.** Un échec d'écriture ne doit pas transformer un login valide en 500, ni un refus légitime en 500 qui ressemble à un bug. En contrepartie l'échec est bruyant : `SECURITY_EVENT_WRITE_FAILED`, un code alertable — une table de sécurité qui cesse de se remplir sans que personne ne le sache vaut moins qu'une table absente, parce qu'on lui fait confiance.

### 🔴 Deux primitives de suppression fermées

**Le volume est choisi par l'attaquant, pas par nous.** Les plus gros émetteurs de cette table sont tous pilotés par l'adversaire. Une ligne par tentative sur une paire déjà verrouillée ferait de `security_events` une amplification de son propre déni de service. Donc : `ACCOUNT_LOCKED` est émis **une fois**, au franchissement du seuil ; une tentative sur une paire déjà verrouillée n'écrit **rien**. Le verrou est la trace.

**Une adresse IP malformée ne doit pas effacer l'événement.** `ip_address` est de type `INET` et sa valeur vient d'`request.ip`, donc potentiellement d'un `X-Forwarded-For`. PostgreSQL refuse une valeur malformée et le recorder ne relance pas : sans validation, envoyer un en-tête invalide suffirait à ne laisser aucune trace de ses tentatives. L'adresse est vérifiée avant l'insertion — on perd l'adresse, jamais l'événement.

### Émetteurs câblés

| Famille | Événements | Ce qu'elle prouve |
|---|---|---|
| `login.use-case.ts` | `LOGIN_SUCCEEDED` `LOGIN_FAILED` `ACCOUNT_LOCKED` `MFA_CHALLENGE_CREATED` | l'événement précède l'identité — colonnes d'acteur nulles |
| `refresh-session.use-case.ts` | `REFRESH_TOKEN_REUSE_DETECTED` `SESSION_COMPROMISED` | émission après une transaction, sur les deux `CRITICAL` |
| `replace-member-roles.use-case.ts` | `ROLE_CHANGED` `ROLE_ESCALATION_ATTEMPTED` | contexte tenant complet, à côté de l'audit |
| `change-membership-status.use-case.ts` | `MEMBERSHIP_REVOKED` | idem, avec la cascade |

**La table préserve la distinction que la réponse HTTP cache.** §5.3 impose un 401 générique pour `UNKNOWN_ACCOUNT`, `NO_CREDENTIAL`, `BAD_PASSWORD` et `USER_NOT_ACTIVE` — dire lequel confirmerait l'existence du compte. `reason_code` est interne : c'est le seul endroit où la distinction survit.

> ✅ **Fait le 15 août 2026.** 21 tests unitaires, 9 d'intégration contre PostgreSQL réel.
>
> ### 🔴 Un cycle d'import invisible partout sauf en e2e
>
> Importer `SecurityEventRecorder` par le baril `../../security-events` referme un cycle `authentication → security-events → authentication`, puisque `AuthenticationModule` importe déjà `SecurityEventsModule`. Sous les modules VM de Jest, ce cycle **bloque** la résolution : `NestFactory.create` ne rend jamais la main, et **les 20 suites e2e échouent, les 259 tests**, en `Exceeded timeout of 5000 ms for a hook` — y compris `health-metrics`, qui ne touche à rien de tout cela.
>
> Rien ne le signale avant : `tsc`, le lint, les 1097 tests unitaires, les 156 d'intégration, les 32 d'architecture et `nest build` passent tous, et l'application démarre en **443 ms** sous `ts-node`. Le symptôme ne ressemble pas non plus à sa cause — un timeout uniforme sur des suites sans rapport, pas une `UnknownDependenciesException`.
>
> Correctif : chemin direct vers le fichier, ce qui est déjà la convention du dossier (`MfaChallengeStore` et `PasswordHasher` sont importés ainsi). Le baril reste correct **entre** modules — `organizations` importe bien depuis `../../identity`, et ses 5 suites passent.
>
> ### Trois constats à reprendre
>
> **Le catalogue de §8 n'a pas de type pour la suspension.** `MEMBERSHIP_REVOKED` y est, `MEMBERSHIP_SUSPENDED` non. Suspension et réactivation restent donc en log et en audit uniquement. Ce n'est pas une omission de ce ticket : c'est le catalogue qui n'a pas prévu le cas.
>
> **`SESSION_REFRESHED` n'est pas émis, délibérément.** Il serait le plus gros contributeur en lignes de toute la table — une par session active toutes les dix minutes, des dizaines de millions par an sur douze mois de rétention — pour dupliquer ce que `refresh_token_rotations` enregistre déjà, et mieux : cette table porte la chaîne complète (`previous_token_id`, `replaced_by_token_id`, `consumed_at`), pas seulement l'horodatage.
>
> **21 des 33 types n'ont toujours pas d'émetteur.** CSRF, origine, rate limit, `TENANT_ACCESS_DENIED`, `UNSCOPED_QUERY_EXECUTED`, mots de passe, MFA, billets et scanners. L'écrivain est conçu face à l'ensemble du catalogue — les 33 sont écrits pour de vrai dans le test d'intégration, donc les trois contraintes `CHECK` sont vérifiées pour chacun — mais brancher les 21 restants demande de toucher autant de sites, ce qui ferait de cette PR une revue impossible. Le câblage restant est mécanique ; la conception ne l'était pas.

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
