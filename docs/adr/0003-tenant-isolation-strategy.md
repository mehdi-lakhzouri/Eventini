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

- `tenant-isolation.spec.ts` passe avec des assertions réelles (aujourd'hui : 2 `it.todo`).
- Test négatif : une requête volontairement non scopée sur un modèle tenant-owned lève `TenantScopeViolationError`.
