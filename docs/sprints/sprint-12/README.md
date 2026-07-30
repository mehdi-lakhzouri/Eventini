# Sprint 12 — Présence, offline et temps réel

> [← Sprint 11](../sprint-11/README.md) · [Index des sprints](../SPRINT_PLAN.md)

| | |
|---|---|
| **Tickets** | EVT-066 → EVT-073 |
| **Prérequis** | Sprint 11 |
| **Migrations** | **12, 14** |
| **Jalon** | 🏁 **M4 — MVP** |

---

## Objectif

Le check-in. C'est le cœur du produit — tout ce qui précède existe pour rendre ce sprint possible.

## Critère de sortie

- le check-in aboutit ;
- **le doublon est refusé** ;
- un lot offline rejoué ne crée **aucun doublon** ;
- le tableau de bord se met à jour en temps réel.

---

## Tickets

| # | Titre | Migration |
|---|---|---|
| [EVT-066](#evt-066) | Check-in en ligne | 12 |
| [EVT-067](#evt-067) | Check-out et corrections | — |
| [EVT-068](#evt-068) | Outbox transactionnelle | 14 |
| [EVT-069](#evt-069) | Synchronisation offline | — |
| [EVT-070](#evt-070) | Scanner web offline | — |
| [EVT-071](#evt-071) | Temps réel SSE | — |
| [EVT-072](#evt-072) | Rapports et exports | — |
| [EVT-073](#evt-073) | Notifications email | — |

---

## EVT-066 — Check-in en ligne
<a id="evt-066"></a>

```
Branche  feat/EVT-066-online-check-in
Commit   feat(attendance): implement idempotent online check-in
Routes   POST /events/{eventId}/check-ins
Tables   attendance_records                                    (migration 12)
Permission  attendance.check_in + Idempotency-Key obligatoire
```

### Trois défenses en profondeur contre un QR partagé

C'est le scénario le plus concret du produit : un participant photographie son QR et l'envoie à un tiers.

| # | Défense | Bloque |
|---|---|---|
| 1 | **Nonce Redis 90 s** | la présentation simultanée sur deux appareils |
| 2 | **`ux_attendance_checkin_unique`** | le doublon logique |
| 3 | **Détection de rafale** (> 20 refus/min par appareil) | un appareil compromis |

```sql
CREATE UNIQUE INDEX ux_attendance_checkin_unique
  ON attendance_records (event_id, registration_id, event_session_id)
  WHERE record_type = 'CHECK_IN' AND result = 'ACCEPTED';
```

### Le doublon est tranché par violation d'index, pas par un SELECT

L'insertion **tente d'écrire** et laisse la contrainte trancher. Une violation d'unicité devient `result = DUPLICATE`.

Un `SELECT` préalable serait sujet à une **course entre deux instances** : deux scans simultanés du même ticket sur deux serveurs verraient tous deux « aucun check-in existant » et écriraient tous deux. La garantie doit vivre dans la base.

### Les refus sont enregistrés

`result ∈ { ACCEPTED, REFUSED, DUPLICATE }`, avec `refusal_reason`. Un refus non tracé est un refus non analysable — et le contexte produit §9.10 exige explicitement le « refus explicite avec raison ».

Motifs : `TICKET_REVOKED`, `SESSION_CLOSED`, `NOT_REGISTERED`, `OUTSIDE_WINDOW`, `ALREADY_CHECKED_IN`, `EVENT_NOT_ACTIVE`, `SIGNATURE_INVALID`.

**Une seule requête produit tous les motifs possibles** — voir [`ENTITY_RELATIONSHIPS.md` §4.7](../../database/ENTITY_RELATIONSHIPS.md). C'est ce qui permet un refus motivé plutôt qu'un `403` opaque devant un participant qui attend.

**Table append-only** — un check-in erroné n'est pas corrigé par un `UPDATE`. Il est compensé par une ligne `CORRECTION` pointant sur la ligne fautive. C'est ce qui rend la présence auditable.

**Tests négatifs obligatoires**

| Test | Attendu |
|---|---|
| Double check-in du même ticket | un seul `ACCEPTED`, le second `DUPLICATE` |
| Deux scans concurrents, deux instances | un seul `ACCEPTED` |
| Rejeu de QR au-delà de 90 s | `TICKET_REPLAY_DETECTED` |
| Session `CLOSED` | `EVENT_SESSION_CLOSED` |
| Hors fenêtre | `CHECK_IN_WINDOW_CLOSED` |
| Ticket révoqué | `TICKET_REVOKED` |
| Pas de `registration_sessions` `GRANTED` | `SESSION_ACCESS_DENIED` |
| Scanner de l'événement A sur l'événement B | `403` |

---

## EVT-067 — Check-out et corrections
<a id="evt-067"></a>

```
Branche  feat/EVT-067-check-out
Routes   POST /events/{eventId}/check-outs
         POST /events/{eventId}/attendance/{recordId}/correction
Permission  attendance.check_out · attendance.override
```

**Corrections** — `record_type = CORRECTION` avec `corrects_record_id`. La ligne d'origine reste intacte. `attendance.override` est une permission distincte et **auditée séparément** : c'est la capacité de contredire le système.

---

## EVT-068 — Outbox transactionnelle
<a id="evt-068"></a>

```
Branche  feat/EVT-068-outbox
Tables   outbox_events                                         (migration 14)
```

### Pourquoi une outbox et pas une publication directe

Le contexte produit §12.6 exige que « le workflow métier produise un événement interne après commit ». Sans table d'outbox, un crash entre le commit et la publication **perd l'événement en silence** : le tableau de bord diverge de la base, et personne ne le sait.

```
BEGIN
  1  réserver la clé d'idempotence
  2  écrire attendance_records
  3  écrire outbox_events            ← MÊME transaction
  4  marquer l'idempotence COMPLETED
COMMIT
→ publier depuis l'outbox            ← APRÈS le commit
```

Publier **avant** le commit annoncerait un check-in qui n'existe pas si la transaction échoue.

**Livraison at-least-once** — les consommateurs doivent être idempotents. Purge des `PUBLISHED` après 7 jours.

**Verrou** — `lock:outbox:publisher`, un publieur actif à la fois. C'est l'un des rares usages légitimes du verrou distribué : de la coordination, pas de la correction.

---

## EVT-069 — Synchronisation offline
<a id="evt-069"></a>

```
Branche  feat/EVT-069-offline-sync
Routes   POST /events/{eventId}/attendance-sync
Permission  attendance.check_in + Idempotency-Key obligatoire
```

### Deux niveaux d'idempotence, délibérément

| Niveau | Clé | Rôle |
|---|---|---|
| Lot | `Idempotency-Key` | renvoyer le lot entier est sans effet |
| Opération | `operationId` (ULID) | chaque opération est rejouable **individuellement**, y compris redécoupée dans un autre lot |

`operationId` est stocké dans `attendance_records.idempotency_key`, protégé par `ux_attendance_idempotency`.

### 🔴 `server_recorded_at` fait toujours foi

`client_recorded_at` est conservé **pour analyse** et n'entre **jamais** dans une décision d'autorisation ni dans un ordonnancement faisant foi.

C'est ce qui permet de tolérer un appareil dont l'horloge est fausse — cas fréquent sur un téléphone resté hors ligne plusieurs jours.

### Arbitrage

| Situation | Résultat |
|---|---|
| Doublon | `ux_attendance_checkin_unique` tranche ⇒ `DUPLICATE` |
| Ticket révoqué entre-temps | refusé — l'état **courant du serveur** l'emporte sur l'état connu du client |
| Session fermée entre-temps | `EVENT_SESSION_CLOSED` |
| Décalage d'horloge client | sans effet |
| Taille de lot | 500 opérations maximum |

**Le client hors ligne n'est jamais l'autorité finale.** Il propose ; le serveur dispose.

**Réponse** — `200`, pas `207`. Chaque opération porte son propre résultat ; le transport a réussi, ce sont certaines opérations métier qui ont été refusées. Un refus n'est pas une erreur HTTP.

**Rétention d'idempotence : 7 jours** pour ces routes — un scanner peut rester déconnecté toute la durée d'un événement multi-jours. 24 h transformerait un rejeu légitime en double check-in.

---

## EVT-070 — Scanner web offline
<a id="evt-070"></a>

```
Branche  feat/EVT-070-offline-scanner
```

`dexie` et `dexie-react-hooks` sont installés et **jamais importés**. C'est ici qu'ils servent.

```
IndexedDB (Dexie)
├── snapshot      public_reference des tickets valides, sessions ouvertes, fenêtres
│                 durée de validité bornée · AUCUNE PII
├── operations    file en attente, chacune avec son operationId
└── syncState     dernière synchronisation, statut
```

**Sécurité offline** — données minimales, validité limitée, chiffrement local si le contexte l'exige, appareil révocable, snapshot versionné, nettoyage après expiration.

**Limite assumée** ([`THREAT_MODEL.md` §4.2](../../security/THREAT_MODEL.md)) — un appareil resté hors ligne continue d'accepter des scans localement. Ces opérations sont **rejetées à la synchronisation**, avec leur motif. C'est le prix du mode hors ligne, et il est explicite.

---

## EVT-071 — Temps réel SSE
<a id="evt-071"></a>

```
Branche  feat/EVT-071-realtime-sse
Routes   GET /events/{eventId}/live   (text/event-stream)
```

```
use case → COMMIT (métier + outbox)
         → publieur outbox
         → Redis pub/sub (fan-out inter-instances)
         → adaptateur SSE → navigateurs abonnés
```

**SSE et non WebSocket** — le flux est unidirectionnel serveur → tableau de bord. `socket.io` est installé côté backend et reste inutilisé ; il n'est introduit que si une bidirectionnalité réelle apparaît.

**Aucune règle métier n'est dupliquée dans le transport.** L'adaptateur diffuse ; il ne décide pas.

| Contrainte | Valeur |
|---|---|
| Connexions par utilisateur | 10 |
| Autorisation | `events.read` sur l'événement, **vérifiée à l'ouverture et périodiquement** |
| Reconnexion | backoff exponentiel côté client |
| Métriques | `active_sse_connections`, `sse_events_sent_total`, `sse_delivery_errors_total` |
| Logs | ouverture et fermeture en `debug`, **jamais** un `info` par événement diffusé |

Une session révoquée doit **fermer** ses connexions SSE : sans cela, un utilisateur déconnecté continue de recevoir des données.

---

## EVT-072 — Rapports et exports
<a id="evt-072"></a>

```
Branche  feat/EVT-072-reporting
Routes   GET  /events/{eventId}/reports/attendance
         POST /reports/exports
Permission  reports.read · reports.export
```

**Rapports** — participants inscrits, présents, taux de présence, check-ins par période et par session, anomalies, activité des scanners.

**Requêtes lourdes** — s'appuient sur `ix_attendance_org_event_time` et `ix_attendance_session_time`. `EXPLAIN ANALYZE` obligatoire en PR : un `Seq Scan` sur `attendance_records` pendant un événement à fort volume est un **incident de production**, pas une lenteur.

**Anomalies** — refus répétés, rafales sur un appareil, opérations offline rejetées, corrections. Elles restent **visibles pour revue**, elles ne sont pas silencieusement écartées.

Exports : mêmes règles que EVT-058, **échappement de formule inclus**.

---

## EVT-073 — Notifications email
<a id="evt-073"></a>

```
Branche  feat/EVT-073-notifications
```

**Emails** — invitation organisation et utilisateur, création de compte, vérification, reset de mot de passe, confirmation de changement, activation et désactivation MFA, connexion suspecte, révocation de session, ticket/QR, rappel, événement annulé, alertes administratives.

**Consommation de l'outbox** — `notifications` ne connaît pas `attendance` ; il écoute `ATTENDANCE_RECORDED` et consomme. Le couplage est inversé.

| Règle | |
|---|---|
| Asynchrone, retry maîtrisé | 5 tentatives, backoff + jitter, dead-letter |
| Gabarits **échappés** | aucune donnée utilisateur interprétée |
| Aucun secret dans un email | |
| Idempotence | un job rejoué n'envoie pas deux fois |
| Aucune PII inutile en log | |

---

## 🏁 Jalon M4 — MVP

Cycle complet démontrable : **organisation → événement → participants → tickets → check-in → rapport**, en ligne et hors ligne, avec audit, temps réel et isolation multi-tenant prouvée.

---

## Après le MVP

| Sujet | Condition |
|---|---|
| Application Flutter | contrats scanner, ticket, présence, idempotence et synchronisation **stables** |
| Vérification de mot de passe compromis | — |
| Impersonation | conception dédiée obligatoire |
| RLS PostgreSQL | exigence de conformité |
| Webhooks sortants | demande client |
| Facturation et quotas | colonnes présentes, application reportée |

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| Doublon détecté par `SELECT` au lieu de l'index | Test de concurrence sur deux instances |
| `client_recorded_at` utilisé pour ordonner | Test avec une horloge client fausse |
| Outbox publiée avant le commit | Test : crash simulé entre commit et publication |
| Refus non enregistrés | `result = REFUSED` obligatoire, testé |
| `UPDATE` sur `attendance_records` | Table append-only ; corrections par nouvelle ligne |
| Rétention d'idempotence à 24 h sur la sync | 7 jours imposés ; sinon double check-in légitime |
| SSE non fermées à la révocation de session | Test dédié |
| `Seq Scan` sur `attendance_records` en production | `EXPLAIN ANALYZE` obligatoire en PR |
