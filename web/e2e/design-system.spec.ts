import { expect, test } from "@playwright/test";

/**
 * Vérifie le socle de design system dans un vrai navigateur — EVT-075.
 *
 * L'intérêt est précisément qu'il s'agisse d'un navigateur : la conformité AA
 * porte sur les couleurs **calculées**, après résolution des variables CSS, de
 * la cascade et du thème actif. Un test en jsdom mesurerait des chaînes de
 * caractères, pas des couleurs, et passerait sur un jeu de tokens cassé.
 */

const AUDIT = "[aria-live='polite']";

test.describe("design system", () => {
  test("mesure toutes les paires déclarées et les valide en thème clair", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/design-system");

    const banner = page.locator(AUDIT).first();
    await expect(banner).toContainText("satisfont AA", { timeout: 15_000 });
    await expect(banner).toContainText("clair");

    // Aucune ligne ne doit porter le verdict d'échec, et il doit y avoir des
    // lignes : une page vide satisferait « aucun échec » sans rien prouver.
    await expect(page.getByText("échec", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("AA", { exact: true }).first(),
    ).toBeVisible();
  });

  test("reste conforme après bascule en thème sombre", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/design-system");
    await expect(page.locator(AUDIT).first()).toContainText("satisfont AA", {
      timeout: 15_000,
    });

    await page
      .getByRole("button", {
        name: "Basculer entre le thème clair et le thème sombre",
      })
      .click();

    await expect(page.locator("html")).toHaveClass(/dark/);

    const banner = page.locator(AUDIT).first();
    await expect(banner).toContainText("sombre");
    await expect(banner).toContainText("satisfont AA");
    await expect(page.getByText("échec", { exact: true })).toHaveCount(0);
  });

  test("annonce et applique prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design-system");

    await expect(
      page.getByText("prefers-reduced-motion actif"),
    ).toBeVisible({ timeout: 15_000 });

    // La règle CSS globale doit avoir neutralisé les durées, pas seulement le
    // mouvement piloté en JavaScript.
    const durationMs = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.transition = "opacity 500ms";
      document.body.append(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });

    // Chrome sérialise 0.01ms en notation scientifique. Les deux graphies
    // décrivent la même durée ; l'assertion accepte celle du moteur.
    expect(["0.01ms", "1e-05s"]).toContain(durationMs);
  });

  test("expose une hiérarchie de titres exploitable au clavier", async ({
    page,
  }) => {
    await page.goto("/design-system");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // Chaque section est nommée : sans cela la page est un mur pour un lecteur
    // d'écran, ce qui serait ironique sur une recette d'accessibilité.
    const sections = page.locator("section[aria-labelledby]");
    expect(await sections.count()).toBeGreaterThan(4);
  });
});
