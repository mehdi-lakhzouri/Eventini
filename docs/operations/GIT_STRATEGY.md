# Eventini — Stratégie Git, branches et releases

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Décision :** [ADR-0018](../adr/0018-git-branching-model.md) — supersède le modèle trunk-based d'[ADR-0017](../adr/0017-delivery-model.md)
> **Dépôt :** `https://github.com/mehdi-lakhzouri/Eventini.git`

---

## 1. Modèle de branches

```
master   ──●────────────●────────────●────────────●──────▶  production, tags uniquement
            ▲            ▲            ▲            ▲
            │ v0.1.0     │ v0.2.0     │ v0.3.0     │ v1.0.0
         release/     release/     release/     release/
            │            │            │            │
develop  ──●──●──●──●───●──●──●──●───●──●──●──●───●──────▶  intégration continue
            ▲  ▲  ▲      ▲  ▲  ▲      ▲  ▲  ▲
         feat/ feat/ feat/  …
```

| Branche | Rôle | Durée de vie | Protégée |
|---|---|---|---|
| `master` | **Production uniquement.** Chaque commit est une release taguée | permanente | 🔒 oui |
| `develop` | **Intégration.** Toujours verte, source de toutes les branches de feature | permanente | 🔒 oui |
| `feat/*` `fix/*` `chore/*` `docs/*` `test/*` | Une feature, un ticket `EVT-###` | **< 3 jours** | non |
| `release/vX.Y.Z` | Stabilisation avant mise en production | 2 à 3 jours | 🔒 oui |
| `hotfix/vX.Y.Z` | Correction urgente en production | < 24 h | 🔒 oui |

**Règle absolue** — on ne commite **jamais** directement sur `master` ni sur `develop`. Tout passe par une pull request.

---

## 2. Flux nominal — une feature

```bash
git checkout develop && git pull origin develop
git checkout -b feat/EVT-024-refresh-token-rotation

# … travail, commits Conventional Commits …

git push -u origin feat/EVT-024-refresh-token-rotation
# ouvrir la PR vers develop
```

| Étape | Règle |
|---|---|
| Base | **`develop`**, jamais `master` |
| Cible de la PR | **`develop`** |
| Merge | **squash** — un ticket = un commit sur `develop` |
| Après merge | la branche est supprimée automatiquement |
| Conflits | rebase sur `develop`, jamais de merge de `develop` dans la feature |

Le squash rend l'historique de `develop` égal à la liste des tickets livrés. `git log --oneline develop` se lit comme un journal de sprint.

---

## 3. Flux de release

Une release n'est **pas** un merge direct de `develop` vers `master`. Elle passe par une branche de stabilisation, ce qui permet de continuer à intégrer des features pendant qu'on stabilise.

```bash
# 1. Couper la release depuis develop
git checkout develop && git pull origin develop
git checkout -b release/v0.2.0

# 2. Figer la version
npm version 0.2.0 --no-git-tag-version --workspaces false   # dans backend/ et web/
git commit -am "chore(release): bump version to 0.2.0"
git push -u origin release/v0.2.0

# 3. Stabilisation — 2 à 3 jours
#    SEULS les correctifs sont autorisés sur cette branche.
#    Aucune feature nouvelle. Chaque correctif = une PR vers release/v0.2.0.

# 4. Merge vers master AVEC un commit de merge (--no-ff)
#    PR release/v0.2.0 → master

# 5. Taguer
git checkout master && git pull origin master
git tag -a v0.2.0 -m "Release v0.2.0 — M2 Identité"
git push origin v0.2.0

# 6. RÉTRO-MERGE vers develop — obligatoire
#    PR release/v0.2.0 → develop
```

### 🔴 L'étape 6 n'est jamais facultative

Les correctifs appliqués pendant la stabilisation existent sur `release/*` et sur `master`, **pas sur `develop`**. Sans rétro-merge, ils sont perdus à la release suivante — et le bug réapparaît en production après avoir été corrigé.

C'est l'erreur la plus fréquente de ce modèle de branches. La CI la détecte : un job vérifie que `master` est un ancêtre de `develop` après chaque release.

**Merge `--no-ff`, pas squash**, pour `release → master` et `release → develop` : on veut conserver l'historique des correctifs de stabilisation.

---

## 4. Flux de hotfix

Pour un défaut en production qui ne peut pas attendre la release suivante.

```bash
git checkout master && git pull origin master
git checkout -b hotfix/v1.0.1

# … correctif minimal, rien d'autre …

# PR hotfix/v1.0.1 → master     (merge --no-ff)
git tag -a v1.0.1 -m "Hotfix v1.0.1 — <résumé>"
git push origin v1.0.1

# PR hotfix/v1.0.1 → develop    (rétro-merge OBLIGATOIRE)
```

| Règle | |
|---|---|
| Base | **`master`**, jamais `develop` |
| Portée | le correctif **minimal**. Aucun refactoring, aucune feature |
| Incrément | `PATCH` (`1.0.0 → 1.0.1`) |
| Rétro-merge vers `develop` | **obligatoire**, même si `develop` a déjà divergé |
| Post-mortem | requis pour tout hotfix de sévérité critique |

Un hotfix touchant l'authentification, l'autorisation ou le multi-tenant exige la section « impact sécurité » du gabarit de PR, **sans exception ni raccourci**, quelle que soit l'urgence.

---

## 5. Calendrier des releases

> **Les releases sont alignées sur les jalons, pas sur les sprints.**

C'est délibéré. Plusieurs sprints ne produisent pas d'incrément déployable pris isolément : livrer le sprint 04 (authentification) sans le sprint 05 (rate limiting, CSRF) violerait l'invariant **O-4** — l'endpoint de connexion serait son propre vecteur de déni de service. Un jalon est le plus petit ensemble cohérent et déployable.

| Version | Après le sprint | Jalon | Contenu | Environnement cible |
|---|---:|---|---|---|
| **v0.1.0** | **03** | 🏁 M1 Fondations | démarrage, configuration validée, logs, santé, base de données, audit. **Aucune feature** | développement uniquement |
| **v0.2.0** | **06** | 🏁 M2 Identité | authentification complète, isolation multi-tenant **prouvée par test**, autorisation scopée | **staging** |
| **v0.3.0** | **09** | 🏁 M3 Administration | organisations, invitations, membres, événements, sessions | **bêta / client pilote** |
| **v1.0.0** | **12** | 🏁 M4 MVP | cycle complet jusqu'au check-in, offline, temps réel, rapports | **production** |

### Ce que chaque release autorise

| Release | Ce qui devient possible | Ce qui reste impossible |
|---|---|---|
| v0.1.0 | déployer l'application, vérifier sa configuration et ses logs | se connecter |
| v0.2.0 | se connecter, gérer des sessions, **isolation multi-tenant garantie** | créer un événement |
| v0.3.0 | préparer un événement de bout en bout | scanner un participant |
| v1.0.0 | exploiter un événement réel | — |

**v0.2.0 est la release qui compte.** C'est à partir d'elle que le socle de sécurité est fini et que les données d'un client peuvent exister sans risque d'exposition croisée. Avant elle, **aucune donnée réelle ne doit être saisie**, même en staging.

### Cadence indicative

| Repère | Semaine |
|---|---:|
| Début du sprint 01 | S1 |
| **v0.1.0** | S6 |
| **v0.2.0** | S12 |
| **v0.3.0** | S18 |
| **v1.0.0** | S24 |

Entre deux releases, `develop` est déployé en continu sur l'environnement de développement à chaque merge.

### Après la v1.0.0

Passage à une cadence **mensuelle** — `MINOR` par mois, `PATCH` à la demande. Une version majeure uniquement sur rupture de contrat d'API, selon les règles de [`API_CONVENTIONS.md` §1](../api/API_CONVENTIONS.md).

---

## 6. Versionnement

**SemVer** : `MAJOR.MINOR.PATCH`.

| Incrément | Quand |
|---|---|
| `MAJOR` | rupture de contrat d'API — retrait d'un champ requis, renommage, changement de type, changement de règle d'authentification |
| `MINOR` | feature rétrocompatible, champ optionnel ajouté, route ajoutée |
| `PATCH` | correctif rétrocompatible |

**Avant la v1.0.0**, le contrat d'API n'est pas figé : `0.x` autorise des ruptures entre versions mineures. C'est précisément l'intérêt de ne passer en `1.0.0` qu'au MVP.

**Tags** — `vX.Y.Z`, annotés (`git tag -a`), jamais légers. Un tag annoté porte l'auteur, la date et un message ; un tag léger n'est qu'un pointeur.

**Changelog** — généré depuis les Conventional Commits, dans `CHANGELOG.md`, à chaque release.

---

## 7. Protection des branches

### `master`

| Règle | |
|---|---|
| Push direct | **interdit**, y compris pour les administrateurs |
| Source de PR autorisée | `release/*` et `hotfix/*` **uniquement** |
| Revues | 1 approbation minimum + `CODEOWNERS` sur les chemins sensibles |
| Checks requis | **tous**, aucun `continue-on-error` toléré |
| Force-push, suppression | interdits |
| Historique | linéaire non exigé — les merges de release sont explicites |
| Signature | recommandée, obligatoire à partir de v1.0.0 |

### `develop`

| Règle | |
|---|---|
| Push direct | **interdit** |
| Source de PR autorisée | `feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`, `release/*`, `hotfix/*` |
| Revues | 1 approbation minimum |
| Checks requis | ceux actifs au sprint courant ([`SPRINT_PLAN.md` §6](../sprints/SPRINT_PLAN.md)) |
| Branche à jour avant merge | exigé |
| Force-push, suppression | interdits |

### `release/*` et `hotfix/*`

Protégées pendant leur durée de vie : push direct interdit, checks requis, suppression après merge.

---

## 8. Conventions de nommage

```
feat/EVT-024-refresh-token-rotation
fix/EVT-039-frontend-route-guards
chore/EVT-002-strict-typescript
docs/EVT-000-adr-idempotency
test/EVT-036-tenant-isolation
release/v0.2.0
hotfix/v1.0.1
```

| Élément | Règle |
|---|---|
| Préfixe | `feat` `fix` `chore` `docs` `test` `refactor` `perf` `ci` |
| Identifiant | `EVT-###`, obligatoire sauf sur `release/*` et `hotfix/*` |
| Slug | minuscules, tirets, 3 à 5 mots |
| Langue | **anglais** ([ADR-0001](../adr/0001-documentation-language.md)) |

**Commits** — Conventional Commits, en anglais :

```
feat(identity): rotate refresh tokens with reuse detection
fix(identity): scope refresh cookie path to /api/v1/auth/sessions
chore(release): bump version to 0.2.0
```

Une rupture de contrat est signalée par `!` et un pied `BREAKING CHANGE:` :

```
feat(api)!: replace error envelope with RFC 9457

BREAKING CHANGE: error.message is removed, use error.detail
```

---

## 9. Environnements

| Environnement | Branche | Déploiement | Données |
|---|---|---|---|
| **Développement** | `develop` | automatique à chaque merge | jeu de démonstration |
| **Staging** | `release/*` | automatique | copie **anonymisée** de production |
| **Production** | `master` | manuel, après validation en staging | réelles |

**Aucune donnée réelle avant la v0.2.0**, y compris en staging : sans l'isolation multi-tenant du jalon M2 prouvée par test, rien ne garantit qu'un client ne verrait pas les données d'un autre.

**Migrations** — `prisma migrate deploy` en staging puis en production, hors fenêtre d'événement actif. Voir [`MIGRATION_STRATEGY.md` §7](../database/MIGRATION_STRATEGY.md) :

```sql
-- doit valoir 0 avant toute migration en production
SELECT count(*) FROM events
WHERE status = 'ACTIVE' AND now() BETWEEN starts_at AND ends_at;
```

---

## 10. Checklist de release

Avant de couper `release/vX.Y.Z` :

- [ ] tous les tickets du jalon sont `DONE` selon les 21 items du contexte produit §19
- [ ] `develop` est vert sur **tous** les checks
- [ ] aucun `continue-on-error` restant sur un job dont le sprint d'activation est passé
- [ ] budget de tests placeholder respecté (`it.todo` en baisse)
- [ ] migrations testées sur base vierge **et** en incrémental
- [ ] `prisma migrate diff --exit-code` retourne 0
- [ ] `CHANGELOG.md` généré et relu
- [ ] documentation à jour — un contrat modifié met à jour son document
- [ ] ADR écrits pour toute décision structurante du jalon

Avant de merger `release/*` vers `master` :

- [ ] déployé et validé en staging
- [ ] tests de sécurité négatifs passés — les 25 de [`AUTHENTICATION_AUTHORIZATION.md` §11](../security/AUTHENTICATION_AUTHORIZATION.md)
- [ ] `npm audit` sans vulnérabilité haute ou critique
- [ ] secret scan vert
- [ ] plan de rollback documenté
- [ ] sauvegarde de production vérifiée **immédiatement avant**
- [ ] hors fenêtre d'événement actif (requête ci-dessus)

Après le merge :

- [ ] tag annoté poussé
- [ ] **rétro-merge vers `develop` effectué et vérifié**
- [ ] branche de release supprimée
- [ ] `master` est bien un ancêtre de `develop`

---

## 11. Ce qui ne doit jamais être commité

| Interdit | Protection |
|---|---|
| `.env` (hors `.env.example`) | `.gitignore` racine + job CI « no `.env` tracked » |
| Clés privées, `.pem`, `.key`, `.crt` | `.gitignore` + gitleaks |
| `node_modules/`, `dist/`, `.next/` | `.gitignore` |
| Dumps de base, exports de participants | PII |
| `PASSWORD_PEPPER` ou tout secret réel | gitleaks + validation d'environnement |
| Dépôt git imbriqué | vérifié au commit initial |

`docker/.env` contient de **vrais mots de passe** PostgreSQL, pgAdmin et Redis. Il est couvert par le `.gitignore` racine ; le job `security.yml` échoue si un `.env` devient suivi.

> **Si un secret est commité par erreur** : le considérer comme **compromis**. Le retirer de l'historique ne suffit pas — il faut le **révoquer et le régénérer**. Un secret poussé sur un dépôt distant est public, même après un force-push.

---

## 12. Historique du dépôt

**État avant le commit initial du 30 juillet 2026**

| Constat | Conséquence |
|---|---|
| `master` : **0 commit** | aucun historique |
| `web/.git` : **dépôt imbriqué distinct**, 1 commit `699330e Initial commit from Create Next App`, **aucun remote** | committer `web/` aurait créé un **lien de sous-module vide** — aucune source frontend n'aurait été poussée |
| Remote `origin` configuré, **aucune branche** | dépôt distant vierge |

**Résolution** — `web/.git` supprimé (seul le commit de scaffolding create-next-app est perdu ; les fichiers source restent), puis commit initial sur `master` incluant réellement les sources frontend, puis création de `develop`.

C'est le blocage **B-1** de [`SYSTEM_ARCHITECTURE.md` §3.5](../architecture/SYSTEM_ARCHITECTURE.md), ticket **EVT-001**.

**Vérification permanente** — `git ls-files web/src | wc -l` doit retourner un nombre **> 0**. Un `0` ou `1` signifierait que le lien de sous-module est revenu.

---

## 13. Résumé opérationnel

```
Nouvelle feature       develop → feat/EVT-### → PR squash → develop
Release                develop → release/vX.Y.Z → PR --no-ff → master + tag
                                              → PR --no-ff → develop  (OBLIGATOIRE)
Hotfix                 master  → hotfix/vX.Y.Z → PR --no-ff → master + tag
                                               → PR --no-ff → develop (OBLIGATOIRE)

Releases               après les sprints 03, 06, 09, 12
Jamais                 de commit direct sur master ou develop
Toujours               rétro-merger vers develop après une release ou un hotfix
```
