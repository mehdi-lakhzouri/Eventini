# ADR-0001 — Langue de la documentation

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | — |
| **Impacte** | tous les documents de `docs/` |

## Contexte

Le corpus existant (Documents A, B, C, D, soit environ 9 700 lignes) est intégralement rédigé en **français**, avec les identifiants techniques — noms de tables, colonnes, enums, codes de permission, codes d'erreur, event codes — en **anglais**. `EVENTINI_PROJECT_CONTEXT.md`, document canonique, suit la même règle.

Une partie des nouveaux documents s'adresse à des agents IA, qui n'ont pas de préférence linguistique. Le reste s'adresse à l'équipe d'ingénierie, aux reviewers et à la QA.

## Décision

Les nouveaux documents sont rédigés **en français**, avec les identifiants techniques en anglais, exactement comme le corpus existant.

Sont **toujours** en anglais, sans exception :

- noms de tables, colonnes, index, contraintes (`organization_memberships`, `ux_users_normalized_email_active`) ;
- valeurs d'enums (`ACTIVE`, `REFRESH_TOKEN_REUSE_DETECTED`) ;
- codes de permission (`events.update`), codes d'erreur (`AUTH_TENANT_DENIED`), event codes de log ;
- chemins d'URL, noms de headers, noms de cookies, noms de variables d'environnement ;
- noms de branches, préfixes de commits Conventional Commits, titres de PR ;
- contenu des fichiers `.github/` et des scripts Lua (lus par des outils, pas par des humains).

## Conséquences

**Positives** — un seul registre linguistique dans tout `docs/` ; aucune dette de traduction ; les identifiants restent copiables tels quels vers le code sans translittération.

**Négatives** — un contributeur non francophone doit traduire pour lire ; les fichiers `.github/` sont donc en anglais, ce qui crée une frontière linguistique assumée entre `docs/` (français) et les artefacts exécutables (anglais).

## Alternatives rejetées

- **Tout en anglais** — aurait créé un corpus bilingue de fait, le document canonique restant en français. Le coût de lecture croisée dépasse le bénéfice.
- **Anglais + résumé français** — double le volume à maintenir pour un lectorat qui lit déjà le français.

## Vérification

`grep -c` sur un échantillon de titres de section : les nouveaux documents ne contiennent pas de titre de section en anglais, hors blocs de code et tableaux d'identifiants.
