import { expect, test } from "@playwright/test";

/**
 * Le sélecteur de langue — EVT-047.
 *
 * ## 🔴 Ce test est aussi le diagnostic de `DropdownMenu`
 *
 * Le dépôt portait la note « le menu déroulant ne s'ouvre pas, contourné et non
 * diagnostiqué ». Reproduit en jsdom sous trois formes — déclencheur nu,
 * `<Button>` imbriqué, `render={<Button/>}` — le composant s'ouvrait à chaque
 * fois. Mais jsdom n'est pas un navigateur : il ne connaît ni les événements de
 * pointeur réels, ni le positionnement, ni la couche supérieure.
 *
 * Ces parcours-ci s'exécutent dans un Chromium réel. S'ils passent, la note est
 * fausse et `DropdownMenu` est utilisable partout ; s'ils échouent, on tient
 * enfin la reproduction qui manquait.
 *
 * Aucun backend n'est requis : `/login` est public, et changer de langue est
 * une navigation, pas un appel d'API.
 */
test.describe("sélecteur de langue", () => {
  test("s'ouvre au clic et propose les deux langues", async ({ page }) => {
    await page.goto("/login");

    const trigger = page.getByTestId("locale-switcher");
    await expect(trigger).toBeVisible();

    await trigger.click();

    await expect(page.getByTestId("locale-option-fr")).toBeVisible();
    await expect(page.getByTestId("locale-option-en")).toBeVisible();
  });

  /**
   * Le cœur du ticket : le clic doit **réellement** changer la langue, pas
   * seulement l'étiquette du bouton.
   */
  test("bascule en anglais, préfixe l'URL et change le contenu", async ({
    page,
  }) => {
    await page.goto("/login");

    // Sans préfixe, la page est en français : c'est la locale par défaut.
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await page.getByTestId("locale-switcher").click();
    await page.getByTestId("locale-option-en").click();

    await expect(page).toHaveURL(/\/en\/login/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("revient au français sans préfixe", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.getByTestId("locale-switcher").click();
    await page.getByTestId("locale-option-fr").click();

    // `as-needed` : le français n'est jamais préfixé.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  /**
   * 🔴 `localeDetection` est coupé — la langue vient de l'URL, jamais du
   * navigateur.
   *
   * Le contraire ferait qu'un lien français partagé à un anglophone s'ouvre en
   * anglais, ce qui est exactement ce qu'un lien ne doit pas faire.
   */
  test("ignore Accept-Language sur un chemin non préfixé", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await context.close();
  });

  /** Le drapeau est décoratif : c'est le nom de la langue qui informe. */
  test("garde les drapeaux hors de l'arbre d'accessibilité", async ({
    page,
  }) => {
    await page.goto("/login");

    /*
      Attendre le déclencheur avant de cliquer, et pas par superstition : le
      bouton est rendu côté serveur, donc il existe dans le DOM **avant** que
      React n'ait hydraté et attaché son gestionnaire. Un clic immédiat après
      `goto` atterrit dans le vide et le menu ne s'ouvre jamais — ce test-ci
      échouait exactement ainsi pendant que les autres passaient, parce qu'ils
      commencent par une assertion qui laisse le temps à l'hydratation.

      C'est très probablement l'origine de la note « le menu ne s'ouvre pas »
      qui traînait sur ce composant.
    */
    const trigger = page.getByTestId("locale-switcher");
    await expect(trigger).toBeEnabled();
    await trigger.click();

    const option = page.getByTestId("locale-option-en");
    await expect(option).toContainText("English");
    await expect(option.locator("svg[aria-hidden='true']")).toHaveCount(1);
  });
});
