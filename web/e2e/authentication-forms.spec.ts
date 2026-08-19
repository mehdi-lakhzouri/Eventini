import { expect, test, type Locator } from "@playwright/test";

/**
 * Les formulaires d'authentification — EVT-040.
 *
 * Aucun backend n'est requis ici. Ce que ces parcours prouvent, c'est le
 * câblage côté navigateur : que le formulaire se rend, que la validation Zod
 * s'exécute réellement, que l'accessibilité est branchée, et que les écrans
 * sans jeton se comportent correctement.
 *
 * Le parcours de connexion de bout en bout, avec un vrai backend, appartient à
 * la suite e2e du backend — c'est là que vivent la base et Redis. Le doubler
 * ici n'ajouterait qu'un ordonnancement fragile.
 */

/**
 * Attend que la position et la taille d'un élément cessent de bouger — EVT-047.
 *
 * ## 🔴 Le bug que ça corrige n'était pas dans le bouton
 *
 * Les deux tests qui utilisent ce garde mesurent une largeur de bouton
 * « avant » puis « pendant » l'envoi, et comparent les deux. Ils échouaient de
 * façon systématique, et la cause n'avait rien à voir avec le bouton lui-même :
 * la **carte entière** qui l'entoure (`forgotCardIn`, `mfaCardIn`) entre en
 * scène sur 500 ms — `scale: 0.985 → 1`, `y: 16 → 0`. La mesure « avant » était
 * prise immédiatement après `goto()`, en pleine animation d'entrée, donc plus
 * petite que la taille finale. La mesure « pendant » arrivait, elle, après
 * l'aller-retour réseau simulé — largement après que l'entrée soit terminée.
 * Le test comparait donc une carte qui bougeait encore à une carte stabilisée,
 * et prenait l'écart pour un défaut du bouton.
 *
 * ## Pourquoi une attente de stabilité plutôt qu'un délai fixe
 *
 * Un `waitForTimeout(600)` aurait marché, mais aurait couplé le test à une
 * durée d'animation définie ailleurs (`src/lib/motion/variants.ts`) : la
 * changer là-bas sans y penser ici aurait fait revivre exactement ce bug. Ici,
 * on attend un **fait observable** — deux lectures de position à 50 ms
 * d'écart qui coïncident — qui reste vrai quelle que soit la durée choisie
 * pour l'animation.
 */
async function waitForStableLayout(locator: Locator): Promise<void> {
  await expect(async () => {
    const first = await locator.boundingBox();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await locator.boundingBox();

    expect(second).toEqual(first);
  }).toPass({ timeout: 2000 });
}

test.describe("écran de connexion", () => {
  test("la carte compacte tient dans un écran portable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/login");

    const box = await page.locator(".eventini-login-card").boundingBox();

    expect(box).not.toBeNull();
    expect(box?.width ?? Infinity).toBeLessThanOrEqual(560);
    expect((box?.y ?? -1) >= 0).toBe(true);
    expect(
      (box?.y ?? Infinity) + (box?.height ?? Infinity),
    ).toBeLessThanOrEqual(720);

    await page.setViewportSize({ width: 390, height: 667 });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(667);
  });

  test("rend le formulaire avec ses libellés associés", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Bon retour", level: 1 }),
    ).toBeVisible();

    // getByLabel ne trouve le champ que si `htmlFor` et `id` se correspondent :
    // l'assertion vérifie l'étiquetage, pas seulement la présence.
    await expect(page.getByLabel("Adresse électronique")).toBeVisible();
    await expect(page.getByLabel("Mot de passe")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Se connecter" }),
    ).toBeVisible();
    await expect(page.locator(".login-button-icon")).toBeVisible();
  });

  test("présente directement l'état final quand le mouvement est réduit", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");

    const card = page.locator(".eventini-login-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("opacity", "1");
    await expect(card).toHaveCSS("transform", "none");
    await expect(
      page.getByText("Connectez-vous pour gérer vos événements."),
    ).toBeVisible();
    await expect(page.getByText("Gestion centralisée")).toBeVisible();

    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator(".login-submit-motion")).toHaveCSS(
      "transform",
      "none",
    );
  });

  test("valide côté client avant d'appeler le serveur", async ({ page }) => {
    let calls = 0;
    await page.route("**/auth/sessions", (route) => {
      calls += 1;
      return route.abort();
    });

    await page.goto("/login");
    await page.getByLabel("Adresse électronique").fill("pas-une-adresse");
    await page.getByLabel("Mot de passe").fill("x");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(
      page.getByText("Cette adresse électronique est invalide."),
    ).toBeVisible();
    // Rien n'est parti : c'est tout l'intérêt d'une validation cliente.
    expect(calls).toBe(0);
  });

  test("marque le champ fautif pour les technologies d'assistance", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Adresse électronique").fill("pas-une-adresse");
    await page.getByRole("button", { name: "Se connecter" }).click();

    const field = page.getByLabel("Adresse électronique");
    await expect(field).toHaveAttribute("aria-invalid", "true");

    // `aria-describedby` doit désigner le message : sans lui, le champ est
    // signalé en erreur sans que la raison soit jamais annoncée.
    const describedBy = await field.getAttribute("aria-describedby");
    expect(describedBy).toBe("email-error");
  });

  test("n'affiche aucune erreur avant la première soumission", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Adresse électronique").fill("a");
    await page.getByLabel("Mot de passe").click();

    // Reprocher une faute que l'utilisateur n'a pas fini de commettre.
    await expect(
      page.getByText("Cette adresse électronique est invalide."),
    ).toBeHidden();
  });

  /**
   * 🔴 Le message ne distingue jamais « compte inconnu » de « mot de passe
   * faux ». Le backend s'y refuse ; l'écran doit tenir la même ligne.
   */
  test("garde un refus générique, sans révéler si le compte existe", async ({
    page,
  }) => {
    await page.route("**/auth/sessions", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          meta: { requestId: "req_1", timestamp: "", apiVersion: "v1" },
          error: {
            type: "about:blank",
            title: "Identifiants invalides",
            status: 401,
            code: "AUTH_INVALID_CREDENTIALS",
            detail: "Invalid email or password.",
            instance: "",
            errors: [],
            retryable: false,
            extensions: {},
          },
        }),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Adresse électronique").fill("ana@exemple.fr");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Restreint au formulaire : Next monte son propre `role="alert"` pour
    // annoncer les changements de route, et il resterait vide ici.
    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toContainText(
      "Adresse électronique ou mot de passe incorrect.",
    );
    await expect(alert).not.toContainText(/compte|existe|inconnu/i);
  });

  test("bascule vers la vérification MFA en portant le défi", async ({
    page,
  }) => {
    await page.route("**/auth/sessions", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          meta: { requestId: "req_1", timestamp: "", apiVersion: "v1" },
          error: {
            type: "about:blank",
            title: "MFA requise",
            status: 401,
            code: "AUTH_MFA_REQUIRED",
            detail: "",
            instance: "",
            errors: [],
            retryable: false,
            extensions: { challengeId: "chl_01JABC" },
          },
        }),
      }),
    );

    await page.goto("/login");
    await page.getByLabel("Adresse électronique").fill("ana@exemple.fr");
    await page.getByLabel("Mot de passe").fill("un-mot-de-passe-valide");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(/\/verify-mfa\?.*challenge=chl_01JABC/);
  });

  test("demande un jeton CSRF avant la première mutation", async ({ page }) => {
    let issued = 0;
    await page.route("**/auth/csrf-token", (route) => {
      issued += 1;
      return route.fulfill({ status: 200, body: "{}" });
    });
    await page.route("**/auth/sessions", (route) => route.abort());

    await page.goto("/login");
    await page.getByLabel("Adresse électronique").fill("ana@exemple.fr");
    await page.getByLabel("Mot de passe").fill("un-mot-de-passe-valide");
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Sans cet amorçage, la toute première connexion part sans en-tête CSRF et
    // se fait refuser, avec des identifiants pourtant valides.
    await expect.poll(() => issued).toBeGreaterThan(0);
  });
});

test.describe("écrans dérivés", () => {
  test("la récupération compacte tient dans un écran portable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/forgot-password");

    const box = await page.locator(".eventini-auth-card").boundingBox();

    expect(box).not.toBeNull();
    expect(box?.width ?? Infinity).toBeLessThanOrEqual(560);
    expect((box?.y ?? -1) >= 0).toBe(true);
    expect(
      (box?.y ?? Infinity) + (box?.height ?? Infinity),
    ).toBeLessThanOrEqual(720);

    await page.setViewportSize({ width: 390, height: 667 });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(667);
  });

  test("le mot de passe oublié respecte le mouvement réduit", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/forgot-password");

    const card = page.locator(".eventini-auth-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("transform", "none");
    await expect(
      page.getByRole("heading", { name: "Mot de passe oublié" }),
    ).toBeVisible();
  });

  test("conserve la taille du bouton pendant l'envoi", async ({ page }) => {
    await page.route("**/auth/password-reset-requests", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 202, body: "{}" });
    });

    await page.goto("/forgot-password");
    await page.getByLabel("Adresse électronique").fill("ana@exemple.fr");
    const button = page.getByRole("button", { name: "Envoyer le lien" });
    // La carte est encore en train d'entrer en scène juste après `goto()` —
    // voir `waitForStableLayout`. Sans cette attente, la mesure « avant »
    // est prise en pleine animation d'entrée.
    await waitForStableLayout(button);
    const before = await button.boundingBox();
    await button.click();

    const loadingButton = page.getByRole("button", {
      name: "Envoi en cours...",
    });
    await expect(loadingButton).toBeDisabled();
    const during = await loadingButton.boundingBox();
    expect(Math.abs((during?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(
      2,
    );
    expect(
      Math.abs((during?.height ?? 0) - (before?.height ?? 0)),
    ).toBeLessThan(2);
  });

  test("la vérification MFA refuse de s'afficher sans défi", async ({
    page,
  }) => {
    await page.goto("/verify-mfa");

    await expect(
      page.getByRole("heading", { name: "Vérification indisponible" }),
    ).toBeVisible();
  });

  test("la vérification MFA n'accepte que six chiffres", async ({ page }) => {
    let calls = 0;
    await page.route("**/auth/mfa/challenges/*/verification", (route) => {
      calls += 1;
      return route.abort();
    });

    await page.goto("/verify-mfa?challenge=chl_01JABC");
    const field = page.getByLabel("Code de vérification");
    await field.fill("12345");
    await field.press("a");

    await expect(field).toHaveValue("12345");
    await expect(
      page.getByRole("button", { name: "Vérifier le code" }),
    ).toBeDisabled();
    expect(calls).toBe(0);
  });

  test("l'OTP accepte un code complet et active la vérification", async ({
    page,
  }) => {
    await page.goto("/verify-mfa?challenge=chl_01JABC");
    await page.getByLabel("Code de vérification").fill("123456");

    const slots = page.locator('[data-slot="mfa-otp-slot"]');
    await expect(slots).toHaveCount(6);
    await expect(slots).toHaveText(["1", "2", "3", "4", "5", "6"]);
    await expect(
      page.getByRole("button", { name: "Vérifier le code" }),
    ).toBeEnabled();
  });

  test("la vérification MFA respecte le mouvement réduit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/verify-mfa?challenge=chl_01JABC");

    const card = page.locator(".eventini-mfa-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("transform", "none");
    await expect(
      page.getByRole("heading", { name: "Vérifiez votre identité" }),
    ).toBeVisible();
  });

  test("le bouton MFA conserve sa taille pendant la vérification", async ({
    page,
  }) => {
    await page.route("**/auth/csrf-token", (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );
    await page.route("**/auth/mfa/challenges/*/verification", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({ status: 500, body: "{}" });
    });

    await page.goto("/verify-mfa?challenge=chl_01JABC");
    await page.getByLabel("Code de vérification").fill("123456");
    const button = page.getByRole("button", { name: "Vérifier le code" });
    // Même raison que sur le formulaire de mot de passe oublié : `mfaCardIn`
    // anime aussi l'entrée de la carte sur 500 ms.
    await waitForStableLayout(button);
    const before = await button.boundingBox();

    await button.click();
    const loadingButton = page.getByRole("button", {
      name: "Vérification...",
    });
    await expect(loadingButton).toBeDisabled();
    const during = await loadingButton.boundingBox();

    expect(Math.abs((during?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(
      2,
    );
    expect(
      Math.abs((during?.height ?? 0) - (before?.height ?? 0)),
    ).toBeLessThan(2);
  });

  test("affiche le succès avant la redirection", async ({ page }) => {
    await page.route("**/auth/csrf-token", (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );
    await page.route("**/auth/mfa/challenges/*/verification", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            userId: "usr_01JABC",
            sessionId: "ses_01JABC",
            organizationId: "org_01JABC",
            requiresOrganizationSelection: false,
            expiresAt: "2026-08-16T00:00:00.000Z",
          },
          meta: { requestId: "req_mfa", timestamp: "", apiVersion: "v1" },
          error: null,
        }),
      }),
    );

    await page.goto("/verify-mfa?challenge=chl_01JABC");
    await page.getByLabel("Code de vérification").fill("123456");
    await page.getByRole("button", { name: "Vérifier le code" }).click();

    await expect(
      page.getByRole("heading", { name: "Vérification réussie" }),
    ).toBeVisible({ timeout: 700 });
    await expect(
      page.getByText("Redirection vers votre espace Eventini…"),
    ).toBeVisible({ timeout: 700 });
  });

  test("un code MFA rejeté est signalé puis effacé", async ({ page }) => {
    await page.route("**/auth/csrf-token", (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );
    await page.route("**/auth/mfa/challenges/*/verification", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          meta: { requestId: "req_mfa", timestamp: "", apiVersion: "v1" },
          error: {
            type: "about:blank",
            title: "Code MFA invalide",
            status: 401,
            code: "AUTH_MFA_INVALID",
            detail: "",
            instance: "",
            errors: [],
            retryable: false,
            extensions: {},
          },
        }),
      }),
    );

    await page.goto("/verify-mfa?challenge=chl_01JABC");
    const field = page.getByLabel("Code de vérification");
    await field.fill("123456");
    await page.getByRole("button", { name: "Vérifier le code" }).click();

    await expect(
      page.getByText("Code invalide. Vérifiez le code et réessayez."),
    ).toBeVisible();
    await expect(page.locator('[data-slot="mfa-otp-slot"]').first()).toHaveCSS(
      "border-top-color",
      "rgb(239, 68, 68)",
    );
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
  });

  test("le code de secours reste dans le même challenge", async ({ page }) => {
    let submittedCode: string | undefined;
    await page.route("**/auth/csrf-token", (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );
    await page.route("**/auth/mfa/challenges/*/verification", (route) => {
      submittedCode = (route.request().postDataJSON() as { code: string }).code;
      return route.abort();
    });

    await page.goto("/verify-mfa?challenge=chl_01JABC");
    await page
      .getByRole("button", { name: "Utiliser un code de secours" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Code de secours" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Code de secours" })
      .fill("ABCDE-12345");
    await page
      .getByRole("button", { name: "Vérifier le code de secours" })
      .click();

    await expect.poll(() => submittedCode).toBe("ABCDE-12345");
    await expect(page).toHaveURL(/challenge=chl_01JABC/);
  });

  test("la réinitialisation refuse de s'afficher sans jeton", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(
      page.getByRole("heading", { name: "Lien incomplet" }),
    ).toBeVisible();
  });

  test("la réinitialisation exige deux mots de passe identiques", async ({
    page,
  }) => {
    await page.goto("/reset-password?token=tok_01JABC");
    await page
      .getByLabel("Nouveau mot de passe")
      .fill("phrase-de-passe-longue");
    await page.getByLabel("Confirmation").fill("phrase-de-passe-differente");
    await page.getByRole("button", { name: "Enregistrer" }).click();

    // Le jeton est à usage unique : une faute de frappe ne se rattrape pas.
    await expect(
      page.getByText("Les deux mots de passe ne correspondent pas."),
    ).toBeVisible();
  });

  /**
   * La confirmation est identique que l'adresse existe ou non — sans quoi ce
   * formulaire devient un registre des adresses ayant un compte.
   */
  test("la demande de réinitialisation ne révèle pas si le compte existe", async ({
    page,
  }) => {
    await page.route("**/auth/password-reset-requests", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          data: { accepted: true },
          meta: { requestId: "req_1", timestamp: "", apiVersion: "v1" },
          error: null,
        }),
      }),
    );

    await page.goto("/forgot-password");
    await page.getByLabel("Adresse électronique").fill("inconnu@exemple.fr");
    await page.getByRole("button", { name: "Envoyer le lien" }).click();

    await expect(
      page.getByRole("heading", { name: "Vérifiez votre boîte mail" }),
    ).toBeVisible();
    await expect(page.getByText(/Si un compte correspond/)).toBeVisible();
  });
});
