import { expect, test } from "@playwright/test";

/**
 * Sessions et contexte d'organisation — EVT-041.
 *
 * Les réponses sont interceptées : ce qui est vérifié ici est le comportement
 * du navigateur — ce qui s'affiche, ce qui part, ce que le cache conserve —
 * pas que le backend accepte les requêtes. Cette correspondance est établie
 * par lecture des contrôleurs.
 *
 * Une session est simulée en posant le cookie d'accès : le proxy ne vérifie
 * que sa **présence** (AUTH-INV-011), donc cela suffit à franchir la
 * redirection et à atteindre les écrans.
 */

const meta = { requestId: "req_1", timestamp: "", apiVersion: "v1" };

const envelope = (data: unknown) => JSON.stringify({ data, meta, error: null });

const CURRENT_USER = {
  userId: "usr_1",
  email: "ana@exemple.fr",
  firstName: "Ana",
  lastName: "Diallo",
  displayName: "Ana D.",
  status: "ACTIVE",
  emailVerifiedAt: null,
  lastLoginAt: null,
  mfaEnabled: false,
  sessionId: "ses_1",
  organizationId: "org_1",
  membershipId: "mbr_1",
  clientType: "WEB",
  authenticationLevel: "PASSWORD",
  role: "CLIENT_ADMIN",
  permissions: ["events.read", "participants.read", "reports.read"],
};

const SESSIONS = [
  {
    sessionId: "ses_1",
    clientType: "WEB",
    deviceName: "Chrome sur Windows",
    createdAt: "2026-08-14T08:00:00.000Z",
    lastSeenAt: "2026-08-14T10:00:00.000Z",
    current: true,
  },
  {
    sessionId: "ses_2",
    clientType: "MOBILE_SCANNER",
    deviceName: "Scanner d'entrée",
    createdAt: "2026-08-10T08:00:00.000Z",
    lastSeenAt: "2026-08-13T18:30:00.000Z",
    current: false,
  },
];

test.beforeEach(async ({ context, page, baseURL }) => {
  /*
    Le préfixe `__Host-` impose `Secure` et interdit tout attribut `Domain` —
    c'est ce qui empêche un sous-domaine de poser le cookie de session du
    domaine principal. `localhost` est traité comme une origine sûre par les
    navigateurs, donc `secure: true` y est accepté malgré le `http://`.
  */
  const { hostname } = new URL(baseURL ?? "http://localhost:3000");

  await context.addCookies([
    {
      name: "__Host-eventini_access",
      value: "jeton-simule",
      domain: hostname,
      path: "/",
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: envelope(CURRENT_USER),
    }),
  );
});

test.describe("liste des sessions", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/auth/sessions", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: envelope(SESSIONS),
          })
        : route.fulfill({ status: 204, body: "" }),
    );
  });

  test("affiche chaque appareil et signale la session courante", async ({
    page,
  }) => {
    await page.goto("/account/sessions");

    await expect(page.getByText("Chrome sur Windows")).toBeVisible();
    await expect(page.getByText("Scanner d'entrée")).toBeVisible();
    await expect(page.getByText("Cette session")).toBeVisible();
  });

  /**
   * Un bouton de ligne sur la session courante déconnecterait l'utilisateur
   * sans qu'il l'ait demandé, depuis un écran où il gérait ses AUTRES
   * appareils. « Tout déconnecter » existe pour cela et annonce sa conséquence.
   */
  test("n'offre pas de révoquer la session courante depuis sa ligne", async ({
    page,
  }) => {
    await page.goto("/account/sessions");

    await expect(
      page.getByRole("button", { name: /Révoquer la session Chrome/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Révoquer la session Scanner/ }),
    ).toBeVisible();
  });

  test("révoque un appareil ciblé par son identifiant", async ({ page }) => {
    const revoked: string[] = [];

    await page.route("**/auth/sessions/ses_2", (route) => {
      revoked.push(route.request().method());
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/account/sessions");
    await page
      .getByRole("button", { name: /Révoquer la session Scanner/ })
      .click();

    await expect.poll(() => revoked).toEqual(["DELETE"]);
  });

  test("déconnecte partout puis renvoie vers la connexion", async ({
    page,
  }) => {
    /*
      Le backend efface le cookie d'accès en révoquant. Le mock doit le faire
      aussi : sans cela le proxy voit encore une session sur `/login` et
      renvoie vers le tableau de bord — ce qui est son comportement correct,
      et rendrait ce test faussement rouge.
    */
    await page.route("**/auth/sessions", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({
            status: 204,
            headers: {
              "set-cookie":
                "__Host-eventini_access=; Path=/; Max-Age=0; Secure; HttpOnly",
            },
            body: "",
          })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: envelope(SESSIONS),
          }),
    );

    await page.goto("/account/sessions");
    await page.getByRole("button", { name: "Tout déconnecter" }).click();

    // La session courante est incluse : l'utilisateur se déconnecte lui-même,
    // ce qui est l'intérêt du bouton après un vol d'appareil.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("bascule d'organisation", () => {
  const ORGANIZATIONS = [
    {
      organizationId: "org_1",
      membershipId: "mbr_1",
      name: "Congrès Alpha",
      slug: "alpha",
      active: true,
    },
    {
      organizationId: "org_2",
      membershipId: "mbr_2",
      name: "Salon Beta",
      slug: "beta",
      active: false,
    },
  ];

  test("propose les organisations et marque l'active", async ({ page }) => {
    await page.route("**/organizations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope(ORGANIZATIONS),
      }),
    );

    await page.goto("/account/sessions");
    await page.getByRole("button", { name: /Organisation active/ }).click();

    await expect(
      page.getByRole("menuitem", { name: /Salon Beta/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Congrès Alpha/ }),
    ).toBeDisabled();
  });

  test("active l'organisation choisie", async ({ page }) => {
    let activated = "";

    await page.route("**/organizations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope(ORGANIZATIONS),
      }),
    );
    await page.route("**/organizations/org_2/activation", (route) => {
      activated = route.request().method();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: envelope({
          sessionId: "ses_9",
          organizationId: "org_2",
          membershipId: "mbr_2",
          expiresAt: "2026-08-14T11:00:00.000Z",
        }),
      });
    });

    await page.goto("/account/sessions");
    await page.getByRole("button", { name: /Organisation active/ }).click();
    await page.getByRole("menuitem", { name: /Salon Beta/ }).click();

    await expect.poll(() => activated).toBe("POST");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  /**
   * Un menu déroulant à une seule entrée suggère une possibilité qui n'existe
   * pas. Le nom reste affiché : savoir où l'on travaille compte, même sans
   * alternative.
   */
  test("n'affiche pas de menu quand il n'y a qu'un rattachement", async ({
    page,
  }) => {
    await page.route("**/organizations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope([ORGANIZATIONS[0]]),
      }),
    );

    await page.goto("/account/sessions");

    await expect(page.getByText("Congrès Alpha")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Organisation active/ }),
    ).toHaveCount(0);
  });
});

test.describe("navigation filtrée par les permissions", () => {
  test("masque les entrées que les permissions ne couvrent pas", async ({
    page,
  }) => {
    await page.route("**/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // Aucune permission : seules les entrées inconditionnelles subsistent.
        body: envelope({ ...CURRENT_USER, permissions: [] }),
      }),
    );
    await page.route("**/auth/sessions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope(SESSIONS),
      }),
    );

    await page.goto("/account/sessions");

    // Les entrées de la barre latérale sont des liens : les cibler par leur
    // rôle évite de compter aussi les titres de page.
    await expect(page.getByRole("link", { name: "Événements" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Rapports" })).toHaveCount(0);

    // Gérer ses propres sessions n'est pas un privilège accordé par un rôle.
    await expect(page.getByRole("link", { name: "Sessions" })).toBeVisible();
  });

  test("branche les routes livrées et neutralise les modules futurs", async ({
    page,
  }) => {
    await page.route("**/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope({
          ...CURRENT_USER,
          permissions: [
            "organizations.read",
            "users.read",
            "events.read",
            "participants.read",
            "registrations.read",
            "reports.read",
          ],
        }),
      }),
    );
    await page.route("**/organizations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope([]),
      }),
    );

    await page.goto("/dashboard");

    await expect(
      page.getByRole("link", { name: "Tableau de bord" }),
    ).toHaveAttribute("href", "/dashboard");
    await expect(
      page.getByRole("link", { name: "Paramètres" }),
    ).toHaveAttribute("href", "/organization");
    await expect(page.getByRole("link", { name: "Membres" })).toHaveAttribute(
      "href",
      "/organization/members",
    );

    // Les écrans des sprints suivants sont visibles dans la feuille de route,
    // mais restent des boutons inertes tant que leurs pages n'existent pas.
    await expect(
      page.getByRole("button", { name: "Événements" }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Événements" })).toHaveCount(0);
  });

  test("affiche les tooltips lorsque la sidebar est repliée", async ({
    page,
  }) => {
    await page.route("**/organizations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope([]),
      }),
    );

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Reduire la sidebar" }).click();

    await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute(
      "data-state",
      "collapsed",
    );

    await page.getByRole("link", { name: "Tableau de bord" }).hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
      "Tableau de bord",
    );
  });

  test("applique et mémorise le thème choisi", async ({ page }) => {
    await page.route("**/organizations", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope([]),
      }),
    );

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Thème sombre" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      page.getByRole("button", { name: "Thème sombre" }),
    ).toHaveAttribute("data-pressed");
  });
});
