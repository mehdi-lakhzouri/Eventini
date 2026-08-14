# ADR-0019 — Socle de design system : palette, mouvement et élévation

| | |
|---|---|
| **Statut** | **Accepté** |
| **Date** | 2026-08-14 |
| **Ticket** | EVT-075, avant le sprint 07 |
| **Contradiction résolue** | comble un trou total — aucune référence visuelle n'existait |
| **Impacte** | `web/src/app/globals.css`, tout le frontend des sprints 07 à 12 |

## Contexte

Le sprint 07 construit six écrans d'authentification, puis les sprints 08 à 12 ajoutent les tableaux métier. Aucune référence visuelle n'existe : soixante composants shadcn sont installés et **aucun n'est utilisé**, les onze pages de l'App Router sont des souches de 3 à 5 lignes, et `globals.css` porte la palette neutre par défaut — trente tokens à **chroma 0**, entièrement en niveaux de gris.

Sans référence commune, chaque écran décide sa couleur, son espacement et son mouvement dans sa propre PR. Le coût ne se paie pas au sprint 07 mais au sprint 08, quand il faut reprendre ce qui a déjà été livré.

Une palette de marque a été fournie, en clair et en sombre. **Six de ses paires échouaient le contraste AA** qu'impose déjà [`FRONTEND_ARCHITECTURE.md` §12](../architecture/FRONTEND_ARCHITECTURE.md).

## Décision

### Palette — ajustement des sources, pas des usages

Deux couleurs sont ajustées par décalage de luminosité **minimal** en OKLCH, teinte et chroma préservés :

| Token | Source | Retenu | Effet |
|---|---|---|---|
| `--brand` | `#5B8CFF` | `#4270E1` | 3.16 → 4.53:1 |
| `--success` | `#16A34A` | `#008931` | 3.30 → 4.54:1 |

**`--warning` reste `#F59E0B`.** L'ajuster jusqu'à 4.5:1 avec du blanc exigeait `#B46100` — ΔL −0.194 et une teinte passant de 70° à 58°, c'est-à-dire un brun. Un état « attention » brun se lit mal comme un avertissement, et l'ambre est la seule couleur chaude de la palette. Le problème n'était pas la couleur mais l'usage : personne ne pose du texte clair sur de l'ambre. `--warning-foreground` `#1F1300` donne 8.49:1.

**`--border` reste `#D6DDF2`** et un token distinct `--input` est introduit. Porter `--border` à 3:1 exigeait `#8E94A8` — ΔL −0.230, soit chaque carte et chaque tableau cerclés de gris moyen, le changement le plus visible de toute la palette. WCAG 1.4.11 ne vise pas les séparateurs décoratifs ; il vise les frontières de composants interactifs, qui sont exactement le domaine de `--input`.

`--input` est résolu contre la surface **la plus défavorable** sur laquelle un champ peut reposer, pas contre la plus commode.

### `--brand` distinct de `--accent`

Dans shadcn, `--accent` est le fond discret des états de survol, pas la couleur de marque. La marque prend un token propre, `--brand`, et `--accent` conserve sa sémantique avec `Surface Muted`.

### Mouvement premium expressif, avec deux échappatoires

Ressorts, transitions de page, entrées échelonnées. Vocabulaire partagé dans `web/src/lib/motion`, et **liste fermée** des moments expressifs.

`prefers-reduced-motion` est traité aux deux seuls endroits qui comptent : une règle `@media` pour le CSS, et `<MotionConfig reducedMotion="user">` pour le mouvement piloté en JavaScript, que la règle CSS ne peut pas atteindre.

### Élévation teintée

Ombres colorées par la primaire en clair. En sombre, liseré interne clair simulant une lumière rasante — une ombre portée ne se voit pas sur un fond quasi noir.

### Typographie et densité inchangées

Geist conservée, `--radius` maintenu à `0.625rem`. Le document décrit les hauteurs **réelles** de `base-luma` (bouton 36px) plutôt qu'une échelle inventée à côté des composants installés.

### Recette vivante plutôt que contrôle en CI

`/design-system` mesure les ratios au rendu sur les tokens appliqués. Quatre tests Playwright vérifient la conformité en navigateur, dans les deux thèmes.

## Conséquences

- Les tickets EVT-037 à EVT-041 citent `DESIGN_SYSTEM.md` au lieu de décider au cas par cas.
- Deux tokens nouveaux à connaître : `--brand` et `--input`. Un développeur qui écrit `bg-accent` en croyant appliquer la marque obtient un gris bleuté — d'où le §2.2 du document.
- La conformité AA est vérifiée en navigateur, **pas** dans le pipeline. Une régression se voit à la recette visuelle. C'est un choix assumé : le contrôle automatisé a été écarté explicitement.
- `/design-system` répond 404 en production sauf `NEXT_PUBLIC_ENABLE_DESIGN_SYSTEM=true`. La route reste présente dans la sortie de build — Next ne supprime pas une route selon une condition d'exécution — mais rien n'est atteignable ni indexable.

## Alternatives écartées

**Variantes dérivées AA** (`--accent-text`, `--warning-solid-fg`) en gardant la palette intacte. Approche des échelles Radix, techniquement la plus propre, mais elle double le nombre de tokens de couleur et impose de choisir la bonne variante à chaque usage. Écartée au profit d'une valeur par rôle, sauf là où le double rôle est réel (`--border` / `--input`).

**Ajustement des quatre couleurs fautives.** Cohérent — une valeur par rôle, aucun token ajouté — mais l'ambre devenait brun et toutes les bordures gris moyen. Le coût visuel dépassait le gain de simplicité.

**Verre dépoli** pour les surfaces flottantes. Spectaculaire sur le fond bleu profond, mais `backdrop-filter` repeint à chaque image de défilement, et surtout le contraste du texte dépend alors du contenu qui défile dessous : AA ne peut plus être garanti statiquement, ce qui contredit §12 frontalement.

**Inter à la place de Geist.** Aucun gain mesurable, et la page d'accueil existante aurait été à revérifier.

## Références

- [`DESIGN_SYSTEM.md`](../design/DESIGN_SYSTEM.md) — le document normatif
- [`FRONTEND_ARCHITECTURE.md` §12](../architecture/FRONTEND_ARCHITECTURE.md) — accessibilité et qualité
- WCAG 2.1 [1.4.3 Contraste minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [1.4.11 Contraste non textuel](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)
