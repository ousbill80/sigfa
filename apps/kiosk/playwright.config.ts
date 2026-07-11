/**
 * KIOSK-005 — playwright.config.ts
 * Configuration Playwright pour les tests de régression visuelle.
 *
 * IMPORTANT : cet outil requiert un navigateur réel (Chromium) et un serveur
 * Next.js en cours. Il ne peut PAS tourner dans GitHub Actions (CI) sans
 * runner linux avec Chromium installé. Invoquez via `pnpm test:visual`.
 * Gate local / RT-003 uniquement — EXCLU du script `test` standard.
 *
 * Screenshots de référence : apps/kiosk/__screenshots__/<screen>-<locale>.png
 * Résolution kiosk : 1024×768 (plein écran kiosk standard).
 * maxDiffPixelRatio : 0.002 (≤0.2% de pixels différents autorisés).
 *
 * Variable d'environnement : SIGFA_PLAYWRIGHT=1 désactive output:"export"
 * dans next.config.ts pour que le middleware next-intl fonctionne.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/__tests__/visual",
  /* Exécution séquentielle pour la stabilité des screenshots */
  fullyParallel: false,
  workers: 1,
  /* Timeout généreux pour le rendu complet + fonts */
  timeout: 30000,
  /* Reporter minimal pour la CI locale */
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:3003",
    /* Taille kiosk standard 1024×768 */
    viewport: { width: 1024, height: 768 },
    /* Désactivation des animations pour la stabilité (via contextOptions) */
    contextOptions: {
      reducedMotion: "reduce",
    },
    /* Capture en cas d'échec */
    screenshot: "only-on-failure",
    /* Couleur forcée pour la reproductibilité */
    colorScheme: "light",
  },
  /* Serveur Next.js dev — démarré automatiquement */
  webServer: {
    /* SIGFA_PLAYWRIGHT=1 désactive output:export dans next.config.ts */
    command: "SIGFA_PLAYWRIGHT=1 pnpm exec next dev --port 3003",
    url: "http://localhost:3003/fr",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  /* Snapshots : apps/kiosk/__screenshots__/ */
  snapshotDir: "./__screenshots__",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      /* Stabilité couleurs */
      animations: "disabled",
    },
  },
});
