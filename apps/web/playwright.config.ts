/**
 * RT-003 — Configuration Playwright E2E (parcours réels + coupure réseau).
 *
 * Le backend RÉEL (API `REALTIME_MODE=real` + PG16/Redis7 Testcontainers) et
 * l'app web Next sont orchestrés par `e2e/support/global-setup.ts` (et arrêtés
 * par global-teardown) — PAS via `webServer` : l'app web doit démarrer APRÈS
 * l'API pour recevoir son URL réelle. baseURL est fixé (ports loopback fixes).
 *
 * Stabilité (leçon F3/D8/D9) : attentes robustes (expect.poll/toPass,
 * waitForEvent), timeouts généreux, retries CI, traces on-first-retry.
 *
 * EXCLU du script `test` unitaire (vit dans `test:e2e`).
 */
import { defineConfig, devices } from "@playwright/test";

/** Port fixe de l'app web orchestrée (cf. global-setup). */
const WEB_PORT = 4020;

export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  // Parcours séquentiel : un seul backend réel partagé, état DB mutable.
  fullyParallel: false,
  workers: 1,
  // E2E réel = démarrage lourd (containers + 2 serveurs). Timeout généreux.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Retry en CI pour absorber un flake résiduel sur runner 2 cœurs.
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
