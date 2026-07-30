# ADR-0006 — `organizationId` comme unique terme pour le tenant

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-6**, **C-7** |
| **Impacte** | logs, claims JWT, paramètres d'API, noms de colonnes, labels de métriques |

## Contexte

Contradiction directe entre deux baselines :

- **Document D §3.2** verrouille le vocabulaire : `organizationId` est le seul nom autorisé, et interdit **explicitement** `orgId`, `tenant`, `tenantId`, `organization`.
- **Document C** utilise `tenantId` partout : filtre §16.4, champ de corrélation §24.3, §26.2, champ de log §36.1, label de métrique §37.2.
- **Document B §17.1** ajoute un troisième usage : un claim JWT nommé `tenantId`.

Résultat : le claim JWT, le filtre d'API et le champ de log portent trois noms pour le même concept. Un `grep organizationId` ne trouve pas les logs, un `grep tenantId` ne trouve pas les colonnes.

## Décision

**`organizationId` partout.** Le Document D l'emporte : c'est le seul document qui a formulé la règle comme une règle, et il possède le schéma de log canonique.

| Contexte | Nom retenu |
|---|---|
| Colonne PostgreSQL | `organization_id` |
| Champ TypeScript / DTO / JSON | `organizationId` |
| Champ de log Pino | `organizationId` |
| Label Prometheus | *aucun* — cardinalité trop élevée (Document D §36) |
| Claim JWT | **`org`** — abrégé, car les claims sont contraints en taille ; documenté dans [ADR-0005](0005-token-signing-eddsa.md) |
| Paramètre de chemin | `{organizationId}` |
| Header | *aucun* — voir [ADR-0002](0002-active-organization-resolution.md), le tenant ne vient jamais d'un header |

Le mot **« tenant » reste utilisé en prose** pour désigner le concept (« isolation multi-tenant », « tenant-owned », `TenantContext`, `TenantScopeViolationError`). Il n'est jamais un **nom de champ** transportant une valeur.

Exception unique et assumée : la classe `TenantContext` et le type `TenantOwnership` conservent « tenant » car ils désignent le concept d'isolation, pas l'identifiant.

## Conséquences

**Positives** — un seul `grep` traverse code, logs, base et API ; la corrélation entre un log et une ligne de base est immédiate ; le Document C reste utilisable, seul son vocabulaire est réécrit à la lecture.

**Négatives** — le Document C conserve `tenantId` dans son texte d'origine (non modifié par principe) ; son entête de provenance signale la substitution, mais un lecteur pressé peut copier `tenantId` depuis un exemple. Un lint de nommage est prévu en sprint 02.

## Alternatives rejetées

- **`tenantId` partout** — plus neutre et réutilisable si le tenant cessait un jour d'être une organisation. Rejeté : le Document D a formulé une règle explicite, le Document C n'en a formulé aucune, et le modèle métier ancre le tenant sur `organizations`.
- **Tolérer les deux avec un alias** — garantit que les deux existeront pour toujours.

## Vérification

`grep -rn "tenantId" backend/src web/src` doit rester vide en dehors des types `TenantContext` / `TenantOwnership`. Contrôle ajouté au job `lint` (sprint 02).
