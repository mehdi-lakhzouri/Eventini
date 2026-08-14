import { expect, test } from "@playwright/test";

/**
 * Le `proxy` de Next 16 s'exécute-t-il réellement — EVT-039.
 *
 * C'est la seule vérification qui compte pour ce renommage. Les tests unitaires
 * de `config/routes.ts` prouvent les prédicats ; ils ne prouvent pas que Next
 * charge `src/proxy.ts`, appelle l'export nommé `proxy` et applique le
 * `matcher`. Un fichier resté nommé `middleware.ts`, ou un export encore appelé
 * `middleware`, passerait tous les tests unitaires et ne redirigerait rien.
 *
 * Aucune session n'est ouverte ici : ces parcours sont ceux d'un visiteur
 * anonyme, ce qui les rend exécutables avant que l'écran de connexion
 * n'existe (EVT-040).
 */

test.describe("redirections du proxy", () => {
  test("renvoie un visiteur anonyme vers la connexion", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login/);
  });

  /** La destination voulue est conservée pour qu'EVT-040 y ramène. */
  test("conserve la destination dans le paramètre next", async ({ page }) => {
    await page.goto("/dashboard");

    expect(new URL(page.url()).searchParams.get("next")).toBe("/dashboard");
  });

  test("conserve aussi la query string de la destination", async ({ page }) => {
    await page.goto("/events?statut=ouvert");

    expect(new URL(page.url()).searchParams.get("next")).toBe(
      "/events?statut=ouvert",
    );
  });

  test("protège une route qui n'est déclarée nulle part", async ({ page }) => {
    // La liste énumère ce qui est ouvert : tout le reste l'est par défaut.
    await page.goto("/participants/prt_01JABC");

    await expect(page).toHaveURL(/\/login/);
  });

  test("laisse passer la connexion sans boucler", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("laisse passer une invitation, qui s'accepte sans compte", async ({
    page,
  }) => {
    await page.goto("/accept-invitation");

    await expect(page).toHaveURL(/\/accept-invitation$/);
  });

  test("laisse passer la recette de design system", async ({ page }) => {
    // Exiger une session ici serait circulaire : c'est la page qui sert à
    // mettre au point l'écran de connexion.
    await page.goto("/design-system");

    await expect(page).toHaveURL(/\/design-system$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("ne redirige pas les ressources statiques", async ({ request }) => {
    // Le matcher les exclut. Depuis Next 16 le proxy tourne sous Node sur
    // chaque chemin admis : y laisser passer les fragments de bundle
    // interposerait un serveur devant chacun d'eux.
    const response = await request.get("/favicon.ico");

    expect(response.status()).toBeLessThan(400);
  });
});
