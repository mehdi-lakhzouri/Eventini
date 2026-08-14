# Eventini — Design system

| | |
|---|---|
| **Statut** | `BASELINE` — normatif pour tout le frontend |
| **Décision** | [ADR-0019](../adr/0019-design-system-foundation.md) |
| **Ticket** | EVT-075, avant le sprint 07 |
| **Implémentation** | [`web/src/app/globals.css`](../../web/src/app/globals.css) |
| **Recette vivante** | `/design-system` en développement |

> Les valeurs de ce document sont **mesurées**, pas déclarées. La page `/design-system` recalcule chaque ratio de contraste au rendu, sur les tokens réellement appliqués au document. Si un token change sans que ce fichier suive, la page le dit tout de suite.

---

## 1. Ce que ce document règle, et pourquoi maintenant

Le sprint 07 construit six écrans d'authentification, puis les sprints 08 à 12 ajoutent les tableaux de participants, de membres, de sessions et de rapports. Sans référence commune, chacun de ces écrans décide sa couleur, son espacement et son mouvement dans sa propre PR — et l'on obtient autant de dialectes visuels que de tickets.

L'état de départ : soixante composants shadcn installés, **aucun utilisé**, et une palette par défaut entièrement en niveaux de gris (`chroma 0` sur les trente tokens).

**Contrainte héritée** — [`FRONTEND_ARCHITECTURE.md` §12](../architecture/FRONTEND_ARCHITECTURE.md) impose déjà contraste **AA minimum** et respect de `prefers-reduced-motion`. Ce document ne les assouplit pas.

---

## 2. Couleur

### 2.1 De la palette de marque aux tokens

La palette fournie est la source. Deux couleurs ont dû être ajustées parce qu'elles échouaient AA, par décalage de **luminosité minimal** en OKLCH — teinte et chroma préservés, donc l'identité de la couleur ne bouge pas.

| Rôle palette | Source | Token | Valeur retenue | Ajustement |
|---|---|---|---|---|
| Primary | `#2E3283` | `--primary` | `#2E3283` | aucun — 11.05:1 |
| Primary Hover | `#242867` | `--primary-hover` | `#242867` | aucun — 13.34:1 |
| Accent | `#5B8CFF` | `--brand` | **`#4270E1`** | ΔL −0.087 — 3.16 → 4.53:1 |
| Background | `#F8FAFF` | `--background` | `#F8FAFF` | aucun |
| Surface | `#FFFFFF` | `--card`, `--popover` | `#FFFFFF` | aucun |
| Surface Muted | `#EEF3FF` | `--muted`, `--secondary`, `--accent` | `#EEF3FF` | aucun |
| Border | `#D6DDF2` | `--border` | `#D6DDF2` | aucun — décoratif |
| — | — | `--input` | **`#878CA0`** | nouveau — frontière de composant |
| Text Primary | `#111827` | `--foreground` | `#111827` | aucun — 16.99:1 |
| Text Secondary | `#5B6475` | `--muted-foreground` | `#5B6475` | aucun — 5.96:1 |
| Success | `#16A34A` | `--success` | **`#008931`** | ΔL −0.082 — 3.30 → 4.54:1 |
| Warning | `#F59E0B` | `--warning` | `#F59E0B` | aucun — texte foncé imposé |
| Danger | `#DC2626` | `--destructive` | `#DC2626` | aucun — 4.83:1 |

En sombre : `--primary` `#5B8CFF`, `--brand` `#8FB3FF` (Accent Glow), `--background` `#0B1020`, `--card` `#12182B`, `--popover` `#1A2238`, `--border` `#2B3654`, `--input` `#5F6C8D`, `--foreground` `#F8FAFC`, `--muted-foreground` `#A7B0C3`, `--success` `#22C55E`, `--warning` `#FBBF24`, `--destructive` `#F87171`.

### 2.2 🔴 `--brand` et non `--accent`

Dans shadcn, **`--accent` n'est pas la couleur de marque**. C'est le fond discret des états de survol — élément de menu, ligne de liste, onglet. Y placer le bleu vif rendrait chaque survol saturé, d'un coup, sur les soixante composants.

La couleur de marque est donc **`--brand`**, et `--accent` conserve sa sémantique shadcn avec `Surface Muted`. Quiconque trouve cette table « incohérente » et veut la corriger doit lire ce paragraphe d'abord.

### 2.3 🔴 Trois couleurs qui se comportent autrement qu'on l'attend

**L'ambre ne porte jamais de texte clair.** `#F59E0B` avec du blanc donne **2.15:1** — l'échec le plus large de la palette d'origine. Ce n'est pas un défaut de cette palette en particulier : aucun système sérieux ne pose du blanc sur de l'ambre. Tailwind, Radix et GitHub imposent tous un texte foncé. C'est `--warning-foreground` `#1F1300` (8.49:1) qui règle le problème, pas un changement de couleur.

**En sombre, la primaire porte un texte foncé.** Blanc sur `#5B8CFF` donne 3.16:1 et échoue ; `#0B1020` donne 5.99:1. C'est l'inversion que la plupart des palettes sombres ratent, parce qu'on suppose qu'un bouton coloré prend toujours un libellé clair.

**`--border` et `--input` ne sont pas interchangeables.** `--border` est décoratif — séparateurs, contours de cartes — et `#D6DDF2` à 1.36:1 est parfaitement admissible : WCAG 1.4.11 ne vise pas les séparateurs. `--input` borde des **composants interactifs** et doit tenir 3:1.

`--input` est résolu contre la surface **la plus défavorable** sur laquelle un champ peut reposer : `--muted` `#EEF3FF` en clair, `--popover` `#1A2238` en sombre. Résolu contre le blanc, il donnait 3.02:1 puis retombait à **2.82:1** dès qu'un champ était posé sur une surface atténuée — un écart qui ne se voit qu'à l'usage, dans un dialogue ou un panneau latéral.

Dans le style `base-luma`, `--input` a un **double rôle** : bordure dans `combobox`, `input-otp`, `tabs` et `toggle`, et remplissage à `bg-input/50` dans les champs de saisie. Une seule valeur sert les deux, ce qui évite un token supplémentaire que rien ne consommerait.

### 2.4 Série catégorielle

Cinq teintes à **luminosité constante**, ancrées sur la teinte de marque puis réparties. La luminosité constante donne à chaque série le même poids visuel : aucune ne domine une légende par accident. Chacune tient au moins 3:1 sur le fond.

| Token | Clair | Sombre |
|---|---|---|
| `--chart-1` | `#4571DC` 4.33:1 | `#7DA5FD` 7.28:1 |
| `--chart-2` | `#A54FB3` 4.60:1 | `#D386DF` 6.92:1 |
| `--chart-3` | `#0F898F` 4.03:1 | `#1DBEC5` 7.74:1 |
| `--chart-4` | `#1A912E` 3.92:1 | `#64C06A` 7.80:1 |
| `--chart-5` | `#C2520B` 4.46:1 | `#F38651` 7.00:1 |

**La couleur ne porte jamais seule une information.** Une série de graphique se distingue aussi par son libellé direct ou son motif ; un état se distingue aussi par son texte. Environ 8 % des hommes ne séparent pas le rouge du vert.

### 2.5 Les 24 paires conformes

Toutes vérifiées en navigateur, dans les deux thèmes, par `e2e/design-system.spec.ts`. Extrait des plus contraintes :

| Paire | Exigence | Clair | Sombre |
|---|---|---|---|
| `foreground / background` | 4.5 | 16.99 | 18.10 |
| `muted-foreground / muted` | 4.5 | 5.36 | 7.25 |
| `primary-foreground / primary` | 4.5 | 11.05 | 5.99 |
| `brand-foreground / brand` | 4.5 | 4.53 | 9.07 |
| `warning-foreground / warning` | 4.5 | 8.49 | 10.56 |
| `input / muted` *(pire cas)* | 3.0 | 3.01 | 3.02 |
| `ring / background` | 3.0 | 4.34 | 5.99 |

---

## 3. Typographie

**Geist Sans** pour l'interface, **Geist Mono** pour les identifiants techniques. Déjà câblées via `next/font` dans `layout.tsx` ; aucune famille supplémentaire n'est chargée.

| Rôle | Taille / interligne | Graisse | Usage |
|---|---|---|---|
| Display | 36 / 40, `-0.02em` | 600 | titre d'écran d'authentification, état vide |
| H1 | 30 / 36, `-0.02em` | 600 | titre de page |
| H2 | 24 / 32, `-0.01em` | 600 | titre de section |
| H3 | 18 / 28 | 600 | titre de carte |
| Body | 14 / 20 | 400 | texte courant, cellules |
| Small | 13 / 18 | 400 | libellés, métadonnées |
| Mono | 13 / 20 | 400 | `req_01JABC`, identifiants |

**Chiffres tabulaires** actifs par défaut sur les tableaux (`font-variant-numeric: tabular-nums` dans `@layer base`). Sans cela, `1 248` et `1 111` n'ont pas la même largeur et les colonnes tremblent à chaque rafraîchissement — visible dès que le tableau de bord se met à jour en temps réel (sprint 11).

`req_01JABC` est affiché dans les messages d'erreur techniques : un utilisateur qui le communique permet de retrouver la requête exacte dans les logs.

---

## 4. Espacement, densité et rayon

Base **4px**. `--radius` vaut `0.625rem` (10px) et n'a pas été modifié.

| Élément | Hauteur | Source |
|---|---|---|
| Bouton `xs` / `sm` / `default` / `lg` | 24 / 32 / **36** / 40 px | `base-luma` |
| Champ de saisie | 36 px | `base-luma` |
| Ligne de tableau | 48 px | convention |
| Carte | `p-24` | convention |
| Écart de section | `gap-24` | convention |

> La taille par défaut du bouton est **36px** (`h-9`), pas 40. C'est la valeur réelle du style `base-luma` installé, et ce document décrit ce qui existe plutôt qu'une échelle inventée à côté.

---

## 5. Élévation

Quatre niveaux, exposés comme `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`.

**En clair, l'ombre est teintée par la primaire, jamais noire.** Une ombre noire sur un fond bleuté vire au gris sale ; la même teintée `rgb(46 50 131)` lit comme de la profondeur. C'est l'écart le plus visible entre une interface correcte et une interface soignée, pour un coût nul.

**En sombre, une ombre portée ne se voit pas** — il n'y a plus de lumière à occulter. La profondeur vient d'un **liseré interne clair en haut** (`inset 0 1px 0 rgb(255 255 255 / 0.04→0.08)`), qui simule une lumière rasante. L'ombre noire subsiste seulement pour détacher du fond.

Deux dégradés : `--gradient-brand` pour le panneau d'authentification et les surfaces de marque, `--gradient-surface` quasi imperceptible pour les surfaces élevées.

---

## 6. Mouvement

Registre **premium expressif**. Tout est importé depuis [`web/src/lib/motion`](../../web/src/lib/motion) — une durée écrite à la main dans un composant est une durée qui divergera.

### 6.1 Durées et courbes

| Nom | Valeur | Usage |
|---|---|---|
| `duration.instant` | 0.12 s | couleur, survol |
| `duration.fast` | 0.18 s | apparition, ouverture de menu |
| `duration.base` | 0.26 s | entrée de page, transition de contenu |
| `duration.slow` | 0.40 s | panneau latéral, feuille modale |
| `easing.emphasized` | `[0.16, 1, 0.3, 1]` | défaut — démarre vite, se pose |
| `easing.exit` | `[0.4, 0, 1, 1]` | sortie — accélère et disparaît |
| `spring.soft` | durée 0.45, bounce 0.12 | dialogues, popovers |
| `spring.snappy` | durée 0.30, bounce 0 | éléments interactifs |
| `spring.expressive` | durée 0.60, bounce 0.28 | moments expressifs uniquement |

### 6.2 Figures

`fadeUp`, `fade`, `staggerContainer` (40 ms entre enfants), `surfaceIn`, `expressiveIn`, `pressable`.

Toutes n'animent que **`opacity`, `transform` et `filter`**. Ce n'est pas une préférence : ces trois propriétés sont composées par le GPU sans repasser par la mise en page. Animer `height`, `top` ou `width` force un recalcul à chaque image et fait tomber les listes longues sous 60 images par seconde.

`staggerContainer` est réservé aux **listes courtes**. Sur cinquante lignes, le dernier élément arriverait deux secondes après le premier — utiliser `fade`.

### 6.3 Liste fermée des moments expressifs

`spring.expressive` et `expressiveIn` ne s'emploient **que** sur : écrans d'authentification, bascule d'organisation, apparition des indicateurs du tableau de bord, toast de succès critique, état vide illustré. Élargir cette liste est une décision de revue, pas un choix d'implémentation — le contraste est ce qui rend ces moments marquants.

### 6.4 🔴 `prefers-reduced-motion` — deux mécanismes, pas un

Le mouvement déclenche des troubles vestibulaires réels. Le registre étant expressif, l'échappatoire compte d'autant plus. Elle est traitée **deux fois, aux deux seuls endroits qui comptent** :

| Mécanisme | Couvre |
|---|---|
| Règle `@media (prefers-reduced-motion: reduce)` dans `globals.css` | transitions et animations **CSS**, plus `scroll-behavior` |
| `<MotionConfig reducedMotion="user">` dans `AppProviders` | mouvement piloté en **JavaScript** par `motion` |

La règle CSS ne couvre pas le second : `motion` anime en JavaScript et ignore entièrement la feuille de style. Traiter cela composant par composant marcherait jusqu'au premier oubli.

---

## 7. Gabarit d'authentification

Panneau divisé : marque à gauche sur `--gradient-brand`, formulaire à droite sur `--card`. Sous **1024px** le panneau disparaît et le formulaire occupe la largeur.

Le panneau porte le logo, une accroche courte et rien de plus. Les six écrans d'authentification partagent le même gabarit — seul le contenu de droite change.

---

## 8. Règles d'usage

- **Aucun bouton plein en `--warning` à libellé clair.** Pastille avec `--warning-foreground`, ou variante `outline`.
- **`--brand` n'est pas une couleur de bordure de champ.** C'est `--input`, et `--ring` au focus.
- **Le focus n'est jamais supprimé ni animé en position.** Un anneau qui glisse vers sa cible est un anneau qu'on perd. `outline-offset: 2px` est global.
- **`--accent` reste le fond de survol**, jamais la marque (§2.2).
- **`dangerouslySetInnerHTML` est interdit** — contexte produit §11.6, toute exception exige un ADR.
- **Le frontend n'est jamais une frontière de sécurité** (AUTH-INV-011). Masquer une action selon un rôle est une commodité ; le backend refuse de toute façon.

---

## 9. Vérification

```bash
cd web
npm run typecheck && npm run lint && npm test
npm run dev                      # puis /design-system
npx playwright test design-system
```

`e2e/design-system.spec.ts` vérifie en navigateur réel : les 24 paires en thème clair, les mêmes après bascule en sombre, l'application effective de `prefers-reduced-motion`, et la hiérarchie de titres.

La mesure est faite en navigateur **par nécessité** : la conformité porte sur les couleurs calculées, après résolution des variables CSS et de la cascade. Un test en jsdom comparerait des chaînes de caractères et passerait sur un jeu de tokens cassé.

> Détail qui a réellement mordu : Tailwind v4 déclare les tokens via `@property`, donc le navigateur les calcule vers une forme canonique et `getComputedStyle` restitue **`lab()`**, jamais l'`oklch()` écrit dans la feuille. Le premier audit a signalé « 24 paires en échec » sur une palette pourtant conforme, parce que l'analyseur ne lisait pas `lab()`. Il retournait `null` plutôt que de deviner — c'est ce qui a rendu le défaut visible immédiatement.

---

## 10. Hors périmètre

Les écrans réels — connexion, MFA, tableau de bord — appartiennent au sprint 07 (EVT-037 à EVT-041). Les catalogues i18n `fr.json` / `en.json` restent le défaut **F-9**. Aucun contrôle de contraste n'est branché en CI : la régression se voit à la recette visuelle, décision assumée de l'ADR-0019.
