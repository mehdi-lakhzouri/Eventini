# ADR-0003 — Stratégie d'isolation multi-tenant en base

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | — |
| **Impacte** | `PrismaService`, tous les repositories, `__architecture__/tenant-isolation.spec.ts` |
| **OWASP** | A01 Broken Access Control · API1 BOLA · API3 BOPLA |

## Contexte

Trois documents énoncent la même règle avec trois formulations (A §10.3, B §31, C §25.3/§26.3) : ne jamais faire `findById(id)` sans filtre tenant. Aucun ne dit comment cette règle est **empêchée d'être oubliée**.

`backend/src/__architecture__/tenant-isolation.spec.ts` existe et contient exactement deux `it.todo`.

## Décision

**Isolation applicative, rendue non contournable par une extension Prisma qui échoue en dur.**

1. **Colonne** — toute table tenant-owned porte `organization_id NOT NULL` avec FK vers `organizations(id)`. Aucune table métier ne dépend d'une jointure transitive pour connaître son tenant.

2. **Signature** — aucun repository n'expose de méthode sans contexte tenant. Le contexte est le **premier** paramètre, jamais optionnel, jamais un `string` nu :

   ```ts
   findEventById(ctx: TenantContext, eventId: string): Promise<Event | null>
   // interdit : findEventById(eventId: string)
   ```

3. **Garde-fou runtime** — une extension du client Prisma intercepte chaque opération. Si le modèle est tenant-owned et que le `where` ne contient pas de contrainte sur `organizationId`, elle **lève** :

   ```ts
   if (TENANT_OWNED_MODELS.has(model) && !hasOrganizationScope(args))
     throw new TenantScopeViolationError(model, operation)
   ```

   Fail closed : en cas de doute, on refuse. Une échappatoire explicite et unique (`prisma.$unscoped(...)`) est réservée aux opérations plateforme, journalisée en `warn` avec `eventCode: UNSCOPED_QUERY_EXECUTED`.

4. **Test d'architecture** — `tenant-isolation.spec.ts` énumère les modèles Prisma, croise avec la liste des modèles tenant-owned et échoue si un modèle tenant-owned n'a pas `organization_id`, ou si un repository expose une méthode publique sans `TenantContext`.

5. **Contrainte de cohérence** — `user_sessions` porte un CHECK : `organization_id` et `active_membership_id` sont tous deux `NULL` (session plateforme) ou tous deux non `NULL` (session tenant). Résout C-29.

**Pas de Row Level Security PostgreSQL.**

## Conséquences

**Positives** — fonctionne avec Prisma 7 et le pooling sans contrainte de transaction ; les violations apparaissent en test, pas en production ; les seeds, migrations et outils d'administration ne nécessitent aucun contournement RLS ; l'erreur est explicite et pointe le modèle fautif.

**Négatives** — la garantie reste applicative : un accès SQL direct (psql, outil BI, script de migration) contourne tout. Cela impose une discipline sur les accès hors application et une revue des scripts de migration. Le jour où un besoin de conformité exige une garantie au niveau moteur, RLS devra être ajouté **en plus** — l'extension Prisma ne devient pas inutile pour autant.

## Alternatives rejetées

- **Application + RLS PostgreSQL** — défense en profondeur réelle, mais impose que chaque requête tourne dans une transaction avec `SET LOCAL app.current_organization_id`, complique le pooling, les tests et les seeds, et double la surface de migration. Reporté, pas exclu.
- **RLS comme frontière principale** — debug opaque, support Prisma inconfortable, et le chemin `BYPASSRLS` nécessaire aux opérations plateforme devient lui-même le maillon faible.

## Vérification

- ✅ `tenant-isolation.spec.ts` passe avec **14 assertions réelles** — les 2 `it.todo` d'origine ont été remplacés par [EVT-018](../sprints/sprint-03/README.md#evt-018), et l'étape CI correspondante n'est plus `continue-on-error`.
- ✅ Test négatif : une requête volontairement non scopée sur un modèle tenant-owned lève `TenantScopeViolationError` — y compris à l'intérieur d'une transaction, vérifié contre PostgreSQL réel.

---

## Notes d'implémentation ([EVT-018](../sprints/sprint-03/README.md#evt-018), 31 juillet 2026)

Trois écarts par rapport à la lettre de cette décision, chacun dans le sens du **fail closed** qu'elle énonce.

### 1. `TENANT_OWNED_MODELS` est une liste d'**exemptions**, pas de protections

Le §3 écrit le contrôle `TENANT_OWNED_MODELS.has(model)` — une liste d'inclusion. Le code l'inverse : **un modèle que personne n'a classé est traité comme tenant-owned et ses requêtes sont refusées.**

Avec une liste d'inclusion, oublier d'y ajouter une nouvelle table tenant la laisse **silencieusement non protégée** : toutes les requêtes passent, aucun test n'échoue, et l'écart reste invisible jusqu'à la première lecture cross-tenant. Avec la liste d'exemptions, la même erreur fait échouer immédiatement chaque requête sur ce modèle, en le nommant. « En cas de doute, on refuse » est la phrase de cette ADR ; une liste d'inclusion échoue **ouvert** sur le seul cas qui compte, celui de l'oubli.

`TENANT_OWNED_MODELS` reste exporté et vaut exactement ce que ce document dit qu'il vaut.

### 2. `membership_role_assignments` est gardé **via une relation** — ✅ résolu par EVT-021

Le §1 exige que « toute table tenant-owned porte `organization_id NOT NULL` » et qu'« aucune table métier ne dépende d'une jointure transitive ». [`DATABASE_SCHEMA.md` §5.6](../database/DATABASE_SCHEMA.md) classe pourtant `membership_role_assignments` en `ORGANIZATION-OWNED` **« (via le membership) »** et n'y liste aucune colonne `organization_id`. EVT-014 a construit ce que le §5.6 spécifiait. C'est la **seule** table de l'inventaire décrite ainsi.

L'exempter aurait été le mauvais arbitrage : c'est la table des attributions de rôle, donc une écriture non scopée y est une escalade de privilège inter-tenant. Elle reste gardée et la garde traverse la relation, ce qui coûte une jointure sur exactement une table. **Correctif livré** — la migration 4 d'[EVT-021](../sprints/sprint-04/README.md#evt-021) ajoute `organization_id NOT NULL` et le trigger `trg_membership_role_tenant`. La table est gardée sur la colonne comme toutes les autres ; la catégorie `ORGANIZATION_OWNED_VIA_RELATION` et le chemin de jointure de l'analyseur sont **supprimés** plutôt que laissés inertes.

### 3. Le client non gardé n'est plus injectable

`$extends` renvoie un **nouveau** client et laisse l'original pleinement fonctionnel — vérifié : une requête émise par le client de base est invisible pour l'extension. `PrismaModule` conserve donc `PrismaService` comme provider, pour ses hooks de cycle de vie, mais **ne l'exporte plus**. Ce qu'un repository injecte est `TENANT_SCOPED_PRISMA`.

Sans cela, l'isolation aurait eu un contournement d'un seul mot, qui aurait ressemblé à la chose évidente à écrire.
