# Sprint 11 — Tickets, QR et scanners

> [← Sprint 10](../sprint-10/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 12 →](../sprint-12/README.md)

| | |
|---|---|
| **Tickets** | EVT-060 → EVT-065 |
| **Prérequis** | Sprint 10 |
| **Migrations** | **7, 11** |
| **Jalon** | — |

---

## Objectif

Émettre des tickets signés, matérialisables en QR code, et enregistrer des appareils scanner affectés à un événement.

## Critère de sortie

- un ticket est émis, son QR est signé, et il ne contient **aucune PII** ;
- un ticket révoqué est refusé ;
- un appareil révoqué perd l'accès ;
- **un scanner de l'événement A ne peut pas scanner l'événement B de la même organisation**.

---

## Tickets

| # | Titre | Migration |
|---|---|---|
| [EVT-060](#evt-060) | Émission de tickets et signature QR | 11 |
| [EVT-061](#evt-061) | Révocation et régénération | — |
| [EVT-062](#evt-062) | Enregistrement d'appareils scanner | 7 |
| [EVT-063](#evt-063) | Affectations d'appareils | 7 |
| [EVT-064](#evt-064) | Activation du contexte scanner | — |
| [EVT-065](#evt-065) | Envoi asynchrone des tickets | — |

---

## EVT-060 — Émission de tickets et signature QR
<a id="evt-060"></a>

```
Branche  feat/EVT-060-ticket-issuance
Routes   POST /events/{eventId}/registrations/{registrationId}/tickets
Tables   tickets                                               (migration 11)
Permission  tickets.issue
```

**Ce qui existait dans le corpus** — le Document B parle de « rotation des clés QR » et de « QR signing », le Document D redacte `qrPayload`, `qrSignature`, `qrSecret`. **Aucun modèle, aucun format de payload, aucun schéma de signature.** Ce ticket les crée.

### 🔴 Ce que le QR contient — et surtout ce qu'il ne contient pas

```
CONTENU AUTORISÉ
  public_reference    128 bits aléatoires, opaque
  key_id              kid de la clé de signature — permet la rotation
  payload_version     version du format
  signature           EdDSA Ed25519

JAMAIS DANS LE QR
  tickets.id          identifiant interne
  email, nom, téléphone, aucune PII
  organizationId, eventId, participantId
  tout identifiant séquentiel ou devinable
```

Le contexte produit §9.8 l'exige : « un QR code ne doit pas exposer directement des données personnelles ou un identifiant séquentiel exploitable ».

**Le secret n'est jamais stocké en clair** — seul son **HMAC-SHA-256** l'est, exactement comme un refresh token. Une fuite de la table `tickets` ne permet pas de fabriquer un QR valide.

### Le QR doit résister à

| Menace | Défense |
|---|---|
| Prédiction | `public_reference` de 128 bits, jamais séquentiel |
| Modification | signature EdDSA vérifiée **avant** toute lecture de base |
| Copie / partage | nonce anti-rejeu 90 s + index unique de check-in |
| Rejeu | nonce Redis à usage unique |
| Fuite d'information | aucune PII dans le payload |
| Usage hors événement | `event_id` vérifié côté serveur |
| Usage hors session | `registration_sessions` consulté |
| Usage après révocation | `status` vérifié |

**Un seul ticket actif par inscription** — `ux_tickets_registration_active(registration_id) WHERE status IN ('ISSUED','ACTIVE')`.

---

## EVT-061 — Révocation et régénération
<a id="evt-061"></a>

```
Branche  feat/EVT-061-ticket-revocation
Routes   DELETE /events/{eventId}/tickets/{ticketId}
         POST   /events/{eventId}/tickets/{ticketId}/regeneration
Permission  tickets.revoke · tickets.issue
```

```
ISSUED → ACTIVE → USED
ISSUED | ACTIVE → REVOKED | EXPIRED | REPLACED
```

**Régénération** — l'ancien ticket passe `REPLACED`, le nouveau porte `replaced_by_ticket_id` vers l'ancien. La chaîne est traçable : on sait toujours pourquoi un ticket a été remplacé.

**Rotation de clé QR** — change `key_id`. Les tickets émis avec l'ancienne clé restent vérifiables pendant la fenêtre de coexistence, dimensionnée sur la durée du plus long événement en cours. Une rotation d'urgence (clé compromise) retire immédiatement l'ancien `key_id` et exige la régénération des tickets concernés.

**Réauthentification requise** pour la rotation de clé QR — c'est l'une des 10 opérations sensibles du Document B §28.

---

## EVT-062 — Enregistrement d'appareils scanner
<a id="evt-062"></a>

```
Branche  feat/EVT-062-scanner-devices
Routes   GET|POST /scanners/devices · PATCH|DELETE /scanners/devices/{deviceId}
Tables   scanner_devices                                       (migration 7)
Permission  scanners.manage
```

```
PENDING → ACTIVE → SUSPENDED | REVOKED | LOST
```

### Correction C-30 — l'index était globalement unique

Le Document A définissait `ux_scanner_device_identifier(device_identifier)` **sans `organization_id`**. Deux problèmes :

1. **canal transverse entre tenants** — le tenant A peut détecter qu'un identifiant est déjà pris par le tenant B, et le lui bloquer ;
2. violation de la règle tenant-first du Document A §8.1 lui-même.

```sql
CREATE UNIQUE INDEX ux_scanner_device_identifier
  ON scanner_devices (organization_id, device_identifier)
  WHERE deleted_at IS NULL;
```

**`last_seen_at`** — mis à jour à chaque activité. Un appareil silencieux depuis longtemps pendant un événement actif est une anomalie à remonter.

---

## EVT-063 — Affectations d'appareils
<a id="evt-063"></a>

```
Branche  feat/EVT-063-scanner-assignments
Routes   GET|POST /events/{eventId}/scanners
         DELETE   /events/{eventId}/scanners/{assignmentId}
Tables   scanner_device_assignments
Permission  scanners.assign
```

### Trois conditions simultanées pour scanner

| # | Condition | Table |
|---|---|---|
| 1 | Membership `ACTIVE` dans l'organisation | `organization_memberships` |
| 2 | Assignation événementielle non révoquée, dans sa fenêtre | `event_user_assignments` (`SCANNER`) |
| 3 | Appareil `ACTIVE` et assigné à cet événement | `scanner_device_assignments` |

Les trois. C'est [ADR-0015](../../adr/0015-scanner-role-scope.md) : `SCANNER` est de portée `EVENT`.

**`allowed_session_ids`** — restriction facultative à un sous-ensemble de sessions (un atelier, une zone, une journée). Tableau vide = toutes les sessions de l'événement.

### Révoquer un appareil perdu ne touche pas au membership

C'est le bénéfice du modèle à trois niveaux : révoquer `scanner_device_assignments` coupe l'accès opérationnel **sans** retirer l'opérateur de l'organisation. Il pourra reprendre avec un autre appareil.

```
scanner_devices → REVOKED | LOST
  → révoquer les scanner_device_assignments
  → révoquer les user_sessions MOBILE_SCANNER de cet appareil
  → security_events: SCANNER_DEVICE_REVOKED
```

---

## EVT-064 — Activation du contexte scanner
<a id="evt-064"></a>

```
Branche  feat/EVT-064-scanner-activation
Routes   POST /scanners/activation
```

```
1  l'opérateur s'authentifie
2  il fournit un eventCode ou choisit une affectation
3  le backend vérifie : appareil, utilisateur, membership, organisation, événement
4  un contexte scanner BORNÉ est créé
5  les sessions autorisées sont chargées
6  les données offline minimales sont synchronisées
7  l'appareil est marqué actif
8  les opérations restent révocables à tout instant
```

**Pourquoi `event_code` est unique globalement** — l'opérateur le saisit **avant** que le tenant soit connu. C'est le seul identifiant du système dans ce cas, d'où l'exigence d'imprévisibilité.

**Snapshot offline** — données **minimales** : `public_reference` des tickets valides, sessions ouvertes, fenêtres. Pas de nom, pas d'email. Durée de validité bornée. Il n'autorise **aucune écriture faisant autorité** : toute opération offline est arbitrée par le serveur à la synchronisation.

**Rate limit** — 5 activations / 15 min par appareil.

---

## EVT-065 — Envoi asynchrone des tickets
<a id="evt-065"></a>

```
Branche  feat/EVT-065-ticket-delivery
Commit   feat(notifications): deliver tickets by email through BullMQ
```

**Scope** — génération de l'image QR (`qrcode`, installé), gabarit d'email (`handlebars`, installé), job BullMQ, suivi de `delivery_status`.

**Règles**

| Règle | |
|---|---|
| Envoi **asynchrone** avec retry maîtrisé | 5 tentatives, backoff exponentiel + jitter |
| Gabarit **échappé** | un nom contenant `<script>` ne doit pas s'exécuter dans le client mail |
| **Aucun secret** dans l'email | ni token, ni identifiant interne, ni lien non expirant |
| `delivery_status` suivi | `PENDING` `SENT` `FAILED` `NOT_APPLICABLE` |
| Jamais de payload QR complet en log | redacté (Document D §30) |

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| **PII glissée dans le payload QR** | Revue de format obligatoire + test : décoder un QR ne révèle aucune donnée personnelle |
| `tickets.id` utilisé comme référence publique | `public_reference` distinct, 128 bits |
| Secret de ticket stocké en clair | HMAC uniquement, comme un refresh token |
| Scanner de portée organisation « pour simplifier » | ADR-0015 + test cross-événement |
| `device_identifier` globalement unique | Correction C-30 appliquée + test cross-tenant |
| Appareil perdu ⇒ on retire le membership | Le modèle à 3 niveaux permet de ne révoquer que l'appareil |
| Gabarit d'email non échappé | Test avec un nom contenant du HTML |
