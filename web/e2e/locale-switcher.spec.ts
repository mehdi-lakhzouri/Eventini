import { expect, test, type Page } from "@playwright/test";

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

/**
 * Ouvre le menu, en réessayant jusqu'à ce qu'il s'ouvre vraiment.
 *
 * ## 🔴 Pourquoi un simple `click()` ne suffit pas
 *
 * Le déclencheur est rendu **côté serveur** : il existe dans le DOM, il est
 * visible et il est activable bien avant que React n'ait hydraté et attaché son
 * gestionnaire. Un clic tombé dans cet intervalle ne fait rien, et le test
 * échoue sur une absence de menu qui n'a rien à voir avec le composant.
 *
 * L'intervalle dépend de la charge de la machine, ce qui rend le défaut
 * intermittent : ces parcours passaient isolément et échouaient dans la suite
 * complète. Attendre `toBeEnabled()` ne le ferme pas — l'attribut ne dit rien
 * de l'hydratation.
 *
 * `toPass()` réessaie le bloc jusqu'à ce qu'il tienne. C'est le motif que
 * Playwright prescrit pour une interaction dont la disponibilité n'a pas de
 * signal observable, et c'est très probablement l'origine de la note « le menu
 * ne s'ouvre pas » qui traînait sur `DropdownMenu`.
 */
async function openLocaleMenu(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByTestId("locale-switcher").click();
    await expect(page.getByTestId("locale-option-en")).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
}

test.describe("sélecteur de langue", () => {
  test("s'ouvre au clic et propose les deux langues", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByTestId("locale-switcher")).toBeVisible();
    await openLocaleMenu(page);

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

    await openLocaleMenu(page);
    await page.getByTestId("locale-option-en").click();

    await expect(page).toHaveURL(/\/en\/login/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  /**
   * 🔴 Le test que ce ticket avait d'abord manqué.
   *
   * La première livraison montait le sélecteur sur des écrans dont la copie
   * restait en dur en français : la langue « changeait » — attribut `lang`,
   * URL, libellé du bouton — sans qu'un seul mot de la page ne bouge. Un
   * sélecteur qui ne change rien est pire que pas de sélecteur.
   *
   * Vérifier `lang` et l'URL ne suffit donc pas : il faut lire le texte.
   */
  test("traduit réellement le contenu de la page", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Bon retour", level: 1 }),
    ).toBeVisible();

    await openLocaleMenu(page);
    await page.getByTestId("locale-option-en").click();

    await expect(
      page.getByRole("heading", { name: "Welcome back", level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Bon retour")).toHaveCount(0);
  });

  /** Les messages de validation Zod suivent la locale, pas le processus. */
  test("traduit aussi les messages de validation", async ({ page }) => {
    await page.goto("/en/login");

    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(
      page.getByText("Your email address is required."),
    ).toBeVisible();
    await expect(page.getByText("Your password is required.")).toBeVisible();
  });

  test("revient au français sans préfixe", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await openLocaleMenu(page);
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

    await openLocaleMenu(page);

    const option = page.getByTestId("locale-option-en");
    await expect(option).toContainText("English");
    await expect(option.locator("svg[aria-hidden='true']")).toHaveCount(1);
  });
});
