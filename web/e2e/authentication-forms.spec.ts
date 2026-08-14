import { expect, test } from "@playwright/test";

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

test.describe("écran de connexion", () => {
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
  test("la vérification MFA refuse de s'afficher sans défi", async ({
    page,
  }) => {
    await page.goto("/verify-mfa");

    await expect(
      page.getByRole("heading", { name: "Vérification indisponible" }),
    ).toBeVisible();
  });

  test("la vérification MFA n'accepte que six chiffres", async ({ page }) => {
    await page.goto("/verify-mfa?challenge=chl_01JABC");
    await page.getByLabel("Code de vérification").fill("12345a");
    await page.getByRole("button", { name: "Vérifier" }).click();

    // Une faute de frappe ne doit pas coûter l'une des cinq tentatives du défi.
    await expect(
      page.getByText("Le code doit contenir exactement six chiffres."),
    ).toBeVisible();
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
    await page.getByLabel("Nouveau mot de passe").fill("phrase-de-passe-longue");
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
      page.getByRole("heading", { name: "Vérifiez votre messagerie" }),
    ).toBeVisible();
    await expect(page.getByText(/Si un compte est associé/)).toBeVisible();
  });
});
