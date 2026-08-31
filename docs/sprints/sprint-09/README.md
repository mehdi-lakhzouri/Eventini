# Sprint 09 — Événements et sessions

> [← Sprint 08](../sprint-08/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 10 →](../sprint-10/README.md)

| | |
|---|---|
| **Tickets** | EVT-048 → EVT-053 |
| **Prérequis** | Sprint 08 |
| **Migrations** | aucune (tables créées au sprint 03) |
| **Jalon** | 🏁 **M3 — Administration** |

---

## Objectif

Un événement est créé, découpé en sessions, activé, puis expiré ou annulé — avec des transitions d'état contrôlées.

## Critère de sortie

- un événement parcourt `DRAFT → ACTIVE → EXPIRED` ;
- les transitions interdites sont **refusées** ;
- les fenêtres de check-in sont calculées dans le **fuseau de l'événement**.

---

## Tickets

| # | Titre | Permission |
|---|---|---|
| [EVT-048](#evt-048) | CRUD événement | `events.read` / `.create` / `.update` |
| [EVT-049](#evt-049) | Transitions d'état | `events.activate` / `.cancel` |
| [EVT-050](#evt-050) | Sessions d'événement | `event_sessions.manage` |
| [EVT-051](#evt-051) | Ouverture et fermeture de session | `event_sessions.manage` |
| [EVT-052](#evt-052) | Affectations | `users.manage_roles` |
| [EVT-053](#evt-053) | UI événements | — |

---

## EVT-048 — CRUD événement
<a id="evt-048"></a>

```
Branche  feat/EVT-048-event-crud
Routes   GET|POST /events · GET|PATCH /events/{eventId}
Tables   events
```

**`PATCH` exige `If-Match`** — un événement est édité concurremment par plusieurs administrateurs. Sans verrou optimiste, l'un écrase silencieusement le travail de l'autre. Absent ⇒ `428 PRECONDITION_REQUIRED`, malformé ⇒ `412 PRECONDITION_FAILED`, périmé ⇒ `409 VERSION_CONFLICT`, conformément au contrat de concurrence commun déjà appliqué aux organisations.

### Trois points de conception

| Point | Raison |
|---|---|
| `event_code` unique **globalement** | un scanner le saisit **avant** que le tenant soit connu. 8 caractères Crockford base32, non prédictible, jamais séquentiel |
| `timezone` obligatoire (IANA) | les fenêtres de check-in se calculent dans le fuseau de l'événement, **pas celui du serveur**. Un événement à Tunis géré depuis Paris ouvrirait une heure trop tôt |
| `slug` unique **par organisation** | deux clients peuvent avoir un événement « sommet-2026 » |

```sql
CONSTRAINT ck_events_date_order CHECK (starts_at < ends_at)
CONSTRAINT ck_events_checkin_window CHECK (
  check_in_opens_at IS NULL OR check_in_closes_at IS NULL
  OR check_in_opens_at < check_in_closes_at
)
```

**Suppression** — soft delete uniquement. Un événement passé porte des enregistrements de présence : le supprimer réellement détruirait la preuve.

---

## EVT-049 — Transitions d'état
<a id="evt-049"></a>

```
Branche  feat/EVT-049-event-state-transitions
Routes   POST /events/{eventId}/activation
         POST /events/{eventId}/cancellation
```

```
DRAFT → ACTIVE          exige ≥ 1 event_session
ACTIVE → EXPIRED        automatique (job) ou manuel
DRAFT | ACTIVE → CANCELLED
EXPIRED, CANCELLED : TERMINAUX — aucun retour
```

Toute transition non listée est **refusée** avec `409 INVALID_STATE_TRANSITION`.

### Effets d'une annulation, même transaction

```
events → CANCELLED
  → révoquer les tickets ISSUED et ACTIVE
  → fermer les event_sessions
  → révoquer les scanner_device_assignments
  → outbox_events: EVENT_CANCELLED
  → audit_logs
```

Idem pour `EXPIRED` : fermeture des sessions, révocation des contextes scanner, `outbox_events: EVENT_EXPIRED`.

**Pourquoi `DRAFT → ACTIVE` exige une session** — sans session, aucun check-in n'est possible. Activer un événement vide crée un état où les opérateurs ont un `event_code` valide et rien à scanner.

**Test** — activer un événement sans session ⇒ `409` ; annuler un événement `EXPIRED` ⇒ `409`.

---

## EVT-050 — Sessions d'événement
<a id="evt-050"></a>

```
Branche  feat/EVT-050-event-sessions
Routes   GET|POST /events/{eventId}/sessions
         GET|PATCH /events/{eventId}/sessions/{sessionId}
Tables   event_sessions
```

Une session représente une journée, un panel, un atelier, une zone ou un créneau : `session_type ∈ { DAY, PANEL, WORKSHOP, ZONE, SLOT }`.

**`organization_id` est dénormalisé** sur `event_sessions`. Ce n'est pas une optimisation : c'est ce qui permet à la garde Prisma de vérifier le scope tenant **sans jointure**. Sans cette colonne, la garde ne peut pas être universelle. La cohérence est maintenue par l'invariant INV-04.

**Multi-jour** — un événement de trois jours porte trois sessions `DAY`, chacune avec sa propre fenêtre de check-in. `requires_separate_check_in` détermine si un participant doit être scanné à chaque session ou une seule fois pour l'événement.

---

## EVT-051 — Ouverture et fermeture de session
<a id="evt-051"></a>

```
Branche  feat/EVT-051-session-open-close
Routes   POST /events/{eventId}/sessions/{sessionId}/opening
         POST /events/{eventId}/sessions/{sessionId}/closure
```

```
SCHEDULED → OPEN → CLOSED
CLOSED : terminal pour le check-in — une réouverture est une NOUVELLE session
```

### La règle de check-in

Un check-in n'est accepté que si la session est **`OPEN`** *et* dans sa **fenêtre horaire**. Les deux, pas l'une ou l'autre.

| Situation | Résultat |
|---|---|
| `OPEN`, dans la fenêtre | accepté |
| `OPEN`, hors fenêtre | `409 CHECK_IN_WINDOW_CLOSED` |
| `SCHEDULED`, dans la fenêtre | `409 EVENT_SESSION_CLOSED` |
| `CLOSED` | `409 EVENT_SESSION_CLOSED` |

Le statut est le contrôle **manuel** de l'opérateur ; la fenêtre est le contrôle **temporel**. Un organisateur doit pouvoir fermer une salle avant l'heure prévue sans modifier les horaires affichés.

**Index dédié** — `ix_event_sessions_open_window(status, check_in_opens_at, check_in_closes_at) WHERE status='OPEN'`. Cette requête est exécutée à **chaque scan**.

---

## EVT-052 — Affectations
<a id="evt-052"></a>

```
Branche  feat/EVT-052-event-assignments
Routes   GET|POST /events/{eventId}/assignments
         DELETE   /events/{eventId}/assignments/{assignmentId}
Tables   event_user_assignments
```

`assignment_type ∈ { EVENT_ADMIN, SCANNER, REPORT_VIEWER, SESSION_MANAGER }`.

**Portée `EVENT`** — c'est ici que se matérialise [ADR-0015](../../adr/0015-scanner-role-scope.md) : `SCANNER` est de portée événement, jamais organisation. Un prestataire recruté pour un événement n'obtient **pas** l'accès aux autres événements du client.

**Fenêtre de validité** — `valid_from` / `valid_until`. Une assignation hors de sa fenêtre n'accorde **aucun droit**, même non révoquée. Les bornes font partie du filtre SQL, pas d'un contrôle applicatif ultérieur.

**Invariant INV-01** — `event_user_assignments.organization_id` = `events.organization_id` = `organization_memberships.organization_id`. Vérifié par trigger.

**Révocation** — `revoked_at`, jamais de suppression. L'index unique est partiel : `WHERE revoked_at IS NULL`, ce qui autorise une réaffectation ultérieure.

**Effet** — toute assignation ou révocation incrémente `permissionsVersion` du membership concerné.

---

## EVT-053 — UI événements
<a id="evt-053"></a>

```
Branche  feat/EVT-053-events-ui
```

**Scope** — liste (TanStack Table, filtres en URL), formulaire de création, éditeur de sessions multi-jour, sélecteur de fuseau, panneau d'affectations, actions de transition avec confirmation.

**Points d'attention UI**

| Point | |
|---|---|
| Fuseau horaire | toujours afficher le fuseau de l'événement à côté des heures, jamais le fuseau du navigateur silencieusement |
| Transitions | actions grisées quand la transition est interdite — mais le backend refuse de toute façon |
| `If-Match` | l'ETag reçu au chargement est renvoyé à l'enregistrement ; un `409 VERSION_CONFLICT` affiche « modifié entre-temps », pas une erreur technique |
| `event_code` | affiché en grand, copiable — c'est ce que l'opérateur saisit sur son scanner |

---

## 🏁 Jalon M3 — Administration

Un client crée son organisation, invite son équipe, crée un événement et le structure. Le produit est utilisable pour la **préparation** d'un événement. Il ne sait pas encore gérer les participants ni le check-in.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| Fenêtres calculées dans le fuseau serveur | `timezone` obligatoire ; test avec un événement dans un autre fuseau |
| `event_code` séquentiel ou prédictible | Crockford base32 aléatoire ; test d'entropie |
| Transition `EXPIRED → ACTIVE` autorisée par erreur | États terminaux testés explicitement |
| Annulation sans révocation des tickets | Effets transactionnels testés |
| `organization_id` non dénormalisé sur `event_sessions` | La garde Prisma lève à la première requête |
| `PATCH` sans `If-Match` accepté | `428` imposé, testé |
