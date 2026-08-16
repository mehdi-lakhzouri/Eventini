/**
 * Conversion OKLCH → sRGB et contraste WCAG 2.1.
 *
 * Ce module existe pour que la page `/design-system` mesure les ratios sur les
 * tokens réellement appliqués, au lieu d'afficher des nombres recopiés depuis
 * la documentation. Une valeur recopiée devient fausse au premier ajustement
 * de `globals.css`, et personne ne s'en aperçoit — c'est précisément le mode de
 * défaillance qu'on veut éviter sur une exigence d'accessibilité.
 *
 * La conversion est écrite ici plutôt que déléguée au navigateur : la
 * sérialisation de `getComputedStyle` pour les couleurs CSS Color 4 varie d'un
 * moteur à l'autre, et une mesure d'accessibilité qui dépend du navigateur qui
 * l'exécute ne mesure pas grand-chose.
 *
 * Matrices de Björn Ottosson (https://bottosson.github.io/posts/oklab/).
 */

export type Rgb = readonly [number, number, number];

/** sRGB encodé → linéaire. */
function toLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Linéaire → sRGB encodé. */
function toEncoded(channel: number): number {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/**
 * `oklch(L C H)` → sRGB dans [0, 1].
 *
 * Les composantes sont bornées après conversion : une teinte très saturée peut
 * tomber hors du gamut sRGB, et un canal négatif fausserait la luminance.
 */
export function oklchToRgb(l: number, c: number, hDegrees: number): Rgb {
  const h = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const clamp = (value: number): number => Math.min(1, Math.max(0, value));

  return [
    clamp(
      toEncoded(
        4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
      ),
    ),
    clamp(
      toEncoded(
        -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
      ),
    ),
    clamp(
      toEncoded(
        -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
      ),
    ),
  ] as const;
}

const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

/**
 * Blanc de référence D50, imposé par CSS Color 4 pour `lab()` — et non D65
 * comme pour sRGB. Confondre les deux décale visiblement les bleus, ce qui
 * fausserait précisément les couleurs de cette palette.
 */
const D50: Rgb = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585] as const;

/**
 * `lab(L a b)` → sRGB.
 *
 * Indispensable, et pas seulement défensif : Tailwind v4 déclare les tokens de
 * thème via `@property` avec `syntax: "<color>"`. Les navigateurs les
 * calculent donc vers une forme canonique, et Chrome restitue `lab()` — jamais
 * l'`oklch()` écrit dans la feuille de style. Sans ce cas, la page mesurerait
 * zéro paire et l'audit serait décoratif.
 *
 * Matrice XYZ D50 → sRGB linéaire de la spécification CSS Color 4.
 */
function labToRgb(l: number, a: number, b: number): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = (fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA) * D50[0];
  const y = (l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA) * D50[1];
  const z = (fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA) * D50[2];

  const linear = [
    3.1341359569958707 * x - 1.6173863321612538 * y - 0.4906619460083532 * z,
    -0.978795502912089 * x + 1.916254567259524 * y + 0.03344273116131949 * z,
    0.07195537988411677 * x - 0.2289768264158322 * y + 1.405386058324125 * z,
  ];

  return linear.map((channel) =>
    Math.min(1, Math.max(0, toEncoded(channel))),
  ) as unknown as Rgb;
}

/** Un nombre CSS : signe optionnel, décimales, notation `.5` admise. */
const NUMBER = String.raw`[+-]?(?:\d*\.)?\d+`;

const OKLCH_PATTERN = new RegExp(
  `^oklch\\(\\s*(${NUMBER}%?)\\s+(${NUMBER})\\s+(${NUMBER})(?:\\s*/\\s*${NUMBER}%?)?\\s*\\)$`,
  "i",
);
const LAB_PATTERN = new RegExp(
  `^lab\\(\\s*(${NUMBER}%?)\\s+(${NUMBER})\\s+(${NUMBER})(?:\\s*/\\s*${NUMBER}%?)?\\s*\\)$`,
  "i",
);
const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

/**
 * Lit une couleur telle que `getComputedStyle` la restitue.
 *
 * Accepte `oklch()`, un hexadécimal et `rgb()`. Retourne `null` sur tout le
 * reste : l'appelant affiche alors « non mesurable » plutôt qu'un ratio
 * silencieusement faux, ce qui est la seule réponse honnête.
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim();

  const oklch = OKLCH_PATTERN.exec(value);
  if (oklch) {
    const rawL = oklch[1];
    const l = rawL.endsWith("%")
      ? Number(rawL.slice(0, -1)) / 100
      : Number(rawL);
    return oklchToRgb(l, Number(oklch[2]), Number(oklch[3]));
  }

  const lab = LAB_PATTERN.exec(value);
  if (lab) {
    const rawL = lab[1];
    // La luminosité de `lab()` est déjà sur 0–100 ; le suffixe `%` que Chrome
    // ajoute n'est qu'une notation, il ne change pas l'échelle.
    const l = rawL.endsWith("%") ? Number(rawL.slice(0, -1)) : Number(rawL);
    return labToRgb(l, Number(lab[2]), Number(lab[3]));
  }

  const hex = HEX_PATTERN.exec(value);
  if (hex) {
    const digits = hex[1];
    return [
      parseInt(digits.slice(0, 2), 16) / 255,
      parseInt(digits.slice(2, 4), 16) / 255,
      parseInt(digits.slice(4, 6), 16) / 255,
    ] as const;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) {
    return [
      Number(rgb[1]) / 255,
      Number(rgb[2]) / 255,
      Number(rgb[3]) / 255,
    ] as const;
  }

  return null;
}

/** Luminance relative, WCAG 2.1 définition 1.4.3. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Ratio de contraste entre deux couleurs, de 1 à 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastRequirement = "text" | "large-text" | "non-text";

/** Le seuil AA applicable, par nature de l'élément. */
export const AA_THRESHOLD: Record<ContrastRequirement, number> = {
  text: 4.5,
  /** ≥ 18.66px gras, ou ≥ 24px. */
  "large-text": 3,
  /** WCAG 1.4.11 — frontières de composants, indicateurs d'état. */
  "non-text": 3,
};

export function meetsAA(
  ratio: number,
  requirement: ContrastRequirement,
): boolean {
  // Arrondi à deux décimales avant comparaison : un ratio affiché « 3.00 » qui
  // échouerait sur 2.9987 serait incompréhensible pour qui lit la page.
  return Math.round(ratio * 100) / 100 >= AA_THRESHOLD[requirement];
}
