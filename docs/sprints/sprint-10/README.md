# Sprint 10 — Participants et inscriptions

> [← Sprint 09](../sprint-09/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 11 →](../sprint-11/README.md)

| | |
|---|---|
| **Tickets** | EVT-054 → EVT-059 |
| **Prérequis** | Sprint 09 |
| **Migrations** | **9, 10** |
| **Jalon** | — |

---

## Objectif

Créer, importer et dédupliquer des participants ; les inscrire à un événement et à ses sessions.

## Critère de sortie

- un CSV de 10 000 lignes s'importe en **asynchrone** avec un rapport accepté/rejeté ;
- les doublons sont détectés ;
- **une formule CSV est neutralisée à l'export**.

---

## Tickets

| # | Titre | Migration |
|---|---|---|
| [EVT-054](#evt-054) | CRUD participant et déduplication | 9 |
| [EVT-055](#evt-055) | Import CSV/Excel asynchrone | — |
| [EVT-056](#evt-056) | Inscriptions | 10 |
| [EVT-057](#evt-057) | Accès par session | 10 |
| [EVT-058](#evt-058) | Exports | — |
| [EVT-059](#evt-059) | UI participants | — |

---

## EVT-054 — CRUD participant et déduplication
<a id="evt-054"></a>

```
Branche  feat/EVT-054-participants
Routes   GET|POST /participants · GET|PATCH|DELETE /participants/{participantId}
Tables   participants                                          (migration 9)
```

### Un participant appartient à l'organisation, pas à l'événement

C'est le choix de modélisation structurant : il peut être inscrit à plusieurs événements sans duplication, et la déduplication devient possible à l'échelle du client.

**Unicité de l'email par organisation, jamais globale.** La même personne peut être participante chez deux clients : ce sont deux enregistrements sans lien. C'est une **exigence d'isolation**, pas une limitation — relier les deux permettrait à un client de déduire la clientèle d'un autre.

```sql
CREATE UNIQUE INDEX ux_participants_org_email_active
  ON participants (organization_id, normalized_email)
  WHERE normalized_email IS NOT NULL AND deleted_at IS NULL;
```

**L'email est optionnel** — un participant peut n'en avoir aucun (inscription sur place, participant mineur). D'où l'index partiel `WHERE normalized_email IS NOT NULL`.

**Déduplication** — `dedup_fingerprint` = hash normalisé de nom + email + téléphone. Il **signale** un doublon probable ; il ne fusionne jamais automatiquement. Une fusion automatique erronée est irréversible.

**PII** — données minimisées. Les exports exigent `participants.export` et sont audités.

---

## EVT-055 — Import CSV/Excel asynchrone
<a id="evt-055"></a>

```
Branche  feat/EVT-055-participant-import
Routes   POST /participants/imports  (202 + Location)
         GET  /jobs/{jobId}
```

**Flux** — upload → validation → parsing en flux → normalisation → détection de doublons → **prévisualisation** → confirmation → import par lots → rapport → audit.

La prévisualisation est obligatoire : un import de 50 000 lignes mal mappées est très pénible à défaire.

### 🔴 Quatre défenses

| Défense | Pourquoi |
|---|---|
| Validation du **contenu réel**, pas seulement du MIME | l'extension et le `Content-Type` sont fournis par le client |
| **Parsing en flux**, jamais en mémoire | un fichier de 10 Mo densément peuplé explose la mémoire s'il est chargé d'un bloc |
| Limites : 10 Mo, 50 000 lignes, 5 imports/h par organisation | OWASP API4 |
| Aucune interprétation HTML | un champ `<script>` reste du texte |

### L'injection de formule — le point qu'on oublie

Une cellule commençant par `=`, `+`, `-` ou `@` est interprétée comme une **formule** par Excel et LibreOffice. `=cmd|' /C calc'!A0` dans un CSV importé puis réexporté s'exécute chez le destinataire.

La donnée **entre inerte et ressort exécutable**. La défense est à l'**export** (EVT-058), pas seulement à l'import : préfixer d'une apostrophe toute cellule commençant par ces caractères.

**Idempotence** — `Idempotency-Key` obligatoire. Un import rejoué après un timeout réseau ne doit pas dupliquer 50 000 participants.

**Rapport** — lignes acceptées, rejetées avec motif et numéro de ligne, doublons détectés. Un import qui échoue sans dire **où** est inutilisable.

---

## EVT-056 — Inscriptions
<a id="evt-056"></a>

```
Branche  feat/EVT-056-registrations
Routes   GET|POST /events/{eventId}/registrations
         PATCH|DELETE /events/{eventId}/registrations/{registrationId}
Tables   registrations                                         (migration 10)
```

```
PENDING → CONFIRMED | REJECTED | WAITLISTED
WAITLISTED → CONFIRMED | CANCELLED
CONFIRMED → CANCELLED
```

**Un participant a au plus une inscription non annulée par événement** — imposé par l'index unique partiel, **pas par le code** :

```sql
CREATE UNIQUE INDEX ux_registrations_event_participant
  ON registrations (event_id, participant_id)
  WHERE status <> 'CANCELLED';
```

La réinscription après annulation reste possible. Deux requêtes concurrentes ne peuvent pas créer deux inscriptions actives.

**`source`** — `MANUAL`, `IMPORT`, `SELF_SERVICE`, `INVITATION`, `API`. Traçabilité de l'origine, utile en rapport et en support.

**`registration_code`** — référence lisible par un humain, unique par événement, communiquée au participant. Distincte du `public_reference` du ticket, qui est cryptographique.

---

## EVT-057 — Accès par session
<a id="evt-057"></a>

```
Branche  feat/EVT-057-registration-sessions
Routes   PUT /events/{eventId}/registrations/{registrationId}/sessions
Tables   registration_sessions                                 (migration 10)
```

**C'est la table interrogée au moment du scan** pour répondre à : « ce porteur a-t-il le droit d'entrer dans **cette** session ? »

**Absence de ligne `GRANTED` ⇒ refus**, sans exception. Le défaut est fermé.

Cas d'usage : un participant inscrit à l'événement a accès aux plénières mais pas à l'atelier payant ; un intervenant a accès à toutes les sessions ; un accompagnant n'a accès qu'à la soirée.

**Attribution groupée** — assigner toutes les sessions d'un événement à une inscription en une opération, sinon l'administration devient impraticable sur un événement à 20 sessions.

---

## EVT-058 — Exports
<a id="evt-058"></a>

```
Branche  feat/EVT-058-exports
Routes   POST /reports/exports  (202 + Location)
Permission  participants.export · registrations.read
```

**Asynchrone** — `202 Accepted` + suivi de job. Un export de 50 000 lignes ne tient pas dans une requête HTTP.

### 🔴 Échappement de formule — obligatoire

```
toute cellule commençant par  =  +  -  @  →  préfixer d'une apostrophe
```

C'est la contrepartie de EVT-055. Sans cela, le système devient un vecteur de transport pour une injection de formule vers les postes des utilisateurs.

**Autres règles**

| Règle | |
|---|---|
| Export **audité** | qui a exporté quoi, quand — c'est de la PII qui sort du système |
| Filtré par tenant, sans exception | un export est une lecture en masse : c'est la surface la plus dangereuse pour une fuite cross-tenant |
| Lien à durée limitée | pas de fichier accessible indéfiniment |
| Rate limit 20/h par organisation | |
| `Idempotency-Key` | un export rejoué ne régénère pas le fichier |

---

## EVT-059 — UI participants
<a id="evt-059"></a>

```
Branche  feat/EVT-059-participants-ui
```

**Scope** — table virtualisée (`@tanstack/react-virtual`, installé), recherche, filtres en URL, assistant d'import avec prévisualisation et mapping de colonnes, panneau de résolution de doublons, formulaire participant.

`libphonenumber-js` et `country-flag-icons` sont installés et inutilisés : c'est ici qu'ils servent (saisie de téléphone E.164, sélecteur de pays).

**Recherche** — 2 à 100 caractères, champs en liste blanche, débouncée. Une recherche non bornée sur une table de participants est une requête coûteuse offerte à l'utilisateur.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| **Injection de formule à l'export** | Échappement obligatoire, testé (EVT-058) |
| Fichier importé chargé entièrement en mémoire | Parsing en flux imposé ; test avec un fichier de 10 Mo |
| Validation du MIME seul | Validation du contenu réel |
| Fusion automatique de doublons | Signalement uniquement ; jamais de fusion sans confirmation |
| Unicité d'email globale au lieu de par organisation | Index scopé + test cross-tenant |
| Export non audité | `audit_logs` obligatoire — c'est de la PII qui sort |
| Deux inscriptions actives pour le même participant | Index unique partiel, testé en concurrence |
