# ADR-0018 — Modèle de branches : `master` + `develop`

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Supersède** | [ADR-0017](0017-delivery-model.md) — **partiellement**, sur le seul modèle de branches |
| **Contradiction résolue** | — |
| **Impacte** | `.github/workflows/`, protection de branches, `SPRINT_PLAN.md`, tout contributeur |

## Contexte

[ADR-0017](0017-delivery-model.md) retenait un modèle **trunk-based** : une seule branche permanente `main`, des branches de feature de moins de 3 jours, un merge en squash. C'était cohérent avec une équipe réduite et un déploiement continu.

Deux éléments ont changé l'analyse :

1. **Le propriétaire du produit a demandé explicitement `master` + `develop`.** C'est une décision de gouvernance, pas un arbitrage technique à re-litiger.
2. **Les releases d'Eventini sont alignées sur des jalons, pas sur des sprints.** Plusieurs sprints ne produisent pas d'incrément déployable pris isolément — livrer le sprint 04 (authentification) sans le sprint 05 (rate limiting, CSRF) violerait l'invariant O-4. Il s'écoule donc 6 semaines entre deux mises en production, pendant lesquelles l'intégration doit continuer.

Ce second point rend le trunk-based moins naturel qu'il n'y paraissait : avec une seule branche permanente et des releases espacées de 6 semaines, il faudrait des feature flags pour masquer le travail en cours en production — une complexité que le modèle à deux branches évite.

## Décision

**Git Flow adapté, à deux branches permanentes.**

| Branche | Rôle |
|---|---|
| `master` | production uniquement — chaque commit est une release taguée |
| `develop` | intégration continue — source de toutes les branches de feature |
| `feature/*` | depuis `develop`, merge **squash** vers `develop` |
| `release/vX.Y.Z` | depuis `develop`, merge `--no-ff` vers `master` **et** rétro-merge vers `develop` |
| `hotfix/vX.Y.Z` | depuis `master`, merge `--no-ff` vers `master` **et** rétro-merge vers `develop` |

**Releases aux jalons** : après les sprints **03, 06, 09 et 12** — `v0.1.0`, `v0.2.0`, `v0.3.0`, `v1.0.0`.

Aucun commit direct sur `master` ni sur `develop`. Les deux sont protégées.

**Ce qui est conservé d'ADR-0017** — sprints de 2 semaines, identifiants `EVT-###`, Conventional Commits, branches de feature de moins de 3 jours, squash vers l'intégration, gabarit de PR avec Definition of Done, checks requis activés progressivement. **Seul le modèle de branches change.**

Détail opérationnel complet : [`GIT_STRATEGY.md`](../operations/GIT_STRATEGY.md).

## Conséquences

**Positives**

- La distinction « prêt pour la production » / « intégré » est portée par la structure du dépôt, pas par une convention que quelqu'un doit se rappeler.
- La branche de release permet de stabiliser pendant que l'intégration continue sur `develop` — indispensable avec 6 semaines entre deux mises en production.
- Le chemin de hotfix est explicite : on part de ce qui tourne réellement en production, pas de l'intégration.
- `master` donne un historique de production lisible : un commit = une release.
- Pas besoin de feature flags pour masquer du travail en cours, ce qui aurait été le coût du trunk-based avec cette cadence.

**Négatives — réelles, à assumer**

- **Le rétro-merge vers `develop` est facile à oublier.** C'est le mode de défaillance classique de ce modèle : un correctif de stabilisation existe sur `master` et pas sur `develop`, et le bug réapparaît à la release suivante. Atténuation : un job CI vérifie que `master` est un ancêtre de `develop` après chaque release.
- Deux branches permanentes à maintenir synchronisées, donc plus de merges et plus d'occasions de conflit.
- Une feature mergée dans `develop` peut attendre jusqu'à 6 semaines avant d'atteindre la production. Le retour du terrain est plus lent qu'en déploiement continu.
- Les branches de release ajoutent une étape de cérémonie à chaque jalon.

## Alternatives rejetées

- **Trunk-based avec `main` seul** (ADR-0017) — moins de cérémonie, retour plus rapide, aucun rétro-merge à oublier. Rejeté sur décision du propriétaire du produit, et parce qu'avec des releases espacées de 6 semaines il aurait exigé des feature flags pour masquer le travail en cours.
- **GitHub Flow** (`main` + branches de feature, déploiement à chaque merge) — suppose un déploiement continu en production, incompatible avec des releases aux jalons.
- **Git Flow complet** (avec `support/*` et branches de version parallèles) — conçu pour maintenir plusieurs versions majeures simultanément. Eventini n'aura qu'une version en production ; ces branches seraient du poids mort.

## Vérification

- Push direct sur `master` ou `develop` : **refusé** par la protection de branche.
- Après chaque release : `git merge-base --is-ancestor master develop` retourne 0 — vérifié en CI.
- `git log --oneline master` ne contient que des commits de merge de release et de hotfix.
- Toute PR vers `master` provient de `release/*` ou `hotfix/*`.
