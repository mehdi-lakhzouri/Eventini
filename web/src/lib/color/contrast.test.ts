import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  meetsAA,
  oklchToRgb,
  parseColor,
  relativeLuminance,
} from "./contrast";

/**
 * Les valeurs attendues ci-dessous ont été calculées indépendamment de ce
 * module, à partir des définitions WCAG et des matrices OKLab, avant qu'il ne
 * soit écrit. Elles ne sont donc pas une capture de la sortie du code : si la
 * conversion se met à mentir, ces tests le disent.
 */

const white = parseColor("#FFFFFF")!;
const hexOf = (rgb: readonly [number, number, number]): string =>
  "#" +
  rgb
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();

describe("oklchToRgb", () => {
  // Aller-retour sur les tokens réellement présents dans globals.css.
  it.each([
    ["primary", 0.3658, 0.1336, 275.45, "#2E3283"],
    ["brand", 0.5743, 0.1795, 264.68, "#4270E1"],
    ["success", 0.549, 0.1622, 147.22, "#008931"],
    ["warning", 0.7686, 0.1647, 70.08, "#F59E0B"],
    ["input", 0.6427, 0.0304, 274.4, "#878CA0"],
  ])("reproduit %s au hexadécimal près", (_name, l, c, h, expected) => {
    expect(hexOf(oklchToRgb(l, c, h))).toBe(expected);
  });

  it("borne les teintes hors gamut sRGB au lieu de rendre un canal négatif", () => {
    const [r, g, b] = oklchToRgb(0.6, 0.4, 150);

    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});

describe("relativeLuminance", () => {
  it("place le blanc à 1 et le noir à 0", () => {
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(parseColor("#000000")!)).toBeCloseTo(0, 5);
  });
});

describe("contrastRatio", () => {
  it("donne 21 pour le noir sur blanc", () => {
    expect(contrastRatio(parseColor("#000000")!, white)).toBeCloseTo(21, 2);
  });

  it("est symétrique", () => {
    const a = parseColor("#2E3283")!;
    expect(contrastRatio(a, white)).toBeCloseTo(contrastRatio(white, a), 10);
  });

  // Les paires du jeu de tokens, avec le ratio mesuré hors de ce module.
  it.each([
    ["primary / blanc", "#2E3283", "#FFFFFF", 11.05],
    ["brand / blanc", "#4270E1", "#FFFFFF", 4.53],
    ["success / blanc", "#008931", "#FFFFFF", 4.54],
    ["warning-foreground / warning", "#1F1300", "#F59E0B", 8.49],
    ["foreground / background", "#111827", "#F8FAFF", 16.99],
    ["input / muted (pire cas clair)", "#878CA0", "#EEF3FF", 3.01],
    ["primary-foreground / primary sombre", "#0B1020", "#5B8CFF", 5.99],
  ])("mesure %s", (_name, a, b, expected) => {
    const ratio = contrastRatio(parseColor(a)!, parseColor(b)!);
    expect(ratio).toBeCloseTo(expected, 1);
  });

  /**
   * La régression que ce ticket a corrigée : la palette d'origine posait du
   * blanc sur l'ambre. Si quelqu'un revient à #F59E0B en fond de bouton clair,
   * ce test rappelle pourquoi c'était refusé.
   */
  it("confirme que du blanc sur l'ambre source échouait bien AA", () => {
    const ratio = contrastRatio(parseColor("#F59E0B")!, white);

    expect(ratio).toBeLessThan(4.5);
    expect(meetsAA(ratio, "text")).toBe(false);
  });
});

describe("parseColor", () => {
  it("lit oklch avec et sans canal alpha", () => {
    expect(parseColor("oklch(0.5743 0.1795 264.68)")).not.toBeNull();
    expect(parseColor("oklch(0.5743 0.1795 264.68 / 0.5)")).not.toBeNull();
  });

  it("lit une luminosité exprimée en pourcentage", () => {
    const asPercent = parseColor("oklch(57.43% 0.1795 264.68)")!;
    const asRatio = parseColor("oklch(0.5743 0.1795 264.68)")!;

    expect(hexOf(asPercent)).toBe(hexOf(asRatio));
  });

  it("lit rgb() tel que le restituent les navigateurs", () => {
    expect(hexOf(parseColor("rgb(46, 50, 131)")!)).toBe("#2E3283");
  });

  /**
   * Le cas qui a réellement cassé l'audit avant d'être traité.
   *
   * Tailwind v4 déclare les tokens de thème via `@property`, donc le navigateur
   * les calcule vers une forme canonique : `getComputedStyle` restitue `lab()`,
   * jamais l'`oklch()` écrit dans `globals.css`. Sans ce cas, les vingt-quatre
   * paires ressortaient « non mesurable » et la page affichait un échec total
   * alors que la palette était conforme.
   *
   * Les valeurs ci-dessous sont celles que Chrome a réellement retournées sur
   * `/design-system`, avec le hexadécimal attendu de `globals.css`.
   */
  it.each([
    ["--foreground", "lab(8.15289% .644758 -11.4851)", "#111827"],
    ["--background", "lab(98.2243% -.0184774 -2.65484)", "#F8FAFF"],
    ["--primary", "lab(24.546% 19.6268 -47.173)", "#2E3283"],
    ["--brand", "lab(48.7565% 13.8227 -63.4983)", "#4270E1"],
    ["--input", "lab(58.3382% 1.31217 -11.3066)", "#878CA0"],
  ])("lit le lab() que Chrome restitue pour %s", (_token, lab, expected) => {
    expect(hexOf(parseColor(lab)!)).toBe(expected);
  });

  it("accepte les nombres négatifs et la notation .5 sans signe", () => {
    expect(parseColor("lab(50% -12.5 .25)")).not.toBeNull();
  });

  // Retourner null plutôt que du noir : un ratio faux est pire qu'un ratio absent.
  it.each([
    "",
    "transparent",
    "var(--primary)",
    "color-mix(in oklch, red, blue)",
  ])("retourne null sur %s au lieu de deviner", (input) => {
    expect(parseColor(input)).toBeNull();
  });
});

describe("meetsAA", () => {
  it("applique 4.5 au texte et 3 au non-texte", () => {
    expect(meetsAA(4.49, "text")).toBe(false);
    expect(meetsAA(4.5, "text")).toBe(true);
    expect(meetsAA(3, "non-text")).toBe(true);
    expect(meetsAA(3, "large-text")).toBe(true);
  });

  it("n'échoue pas sur un ratio qui s'affiche 3.00", () => {
    expect(meetsAA(2.9987, "non-text")).toBe(true);
  });
});
