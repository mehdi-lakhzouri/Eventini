import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * End-to-end flows.
 *
 * Not wired into CI yet: the application has no working flow to exercise.
 * It becomes a required check in sprint 07, when authentication reaches the
 * browser (EVT-037 to EVT-041).
 *
 * Run locally with `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /**
   * 🔴 Plafonné en local, et pas par prudence : `undefined` laisse Playwright
   * ouvrir un worker par cœur, tous pointés sur **un seul** serveur `next dev`.
   *
   * Mesuré sur cette suite, à code identique : 37 échecs sur 53 en workers
   * libres, 2 sur 53 à deux workers. Les échecs n'avaient rien à voir avec le
   * produit — le serveur de développement compile les routes à la demande et
   * s'écroule sous la concurrence, ce qui ressort en pages blanches et en
   * sélecteurs introuvables.
   *
   * Une suite dont le résultat dépend de la charge de la machine ne prouve
   * rien, et pire : elle apprend à ignorer ses propres échecs.
   */
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  // Reuses an already-running dev server locally; starts one in CI.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
