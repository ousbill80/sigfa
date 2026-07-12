/**
 * KIOSK-005 — Tests de régression visuelle Playwright
 *
 * Captures RÉELLES FR/EN pour chaque écran :
 *   - HomeScreen (KIOSK-002)     → home-{locale}.png
 *   - ServicesScreen (KIOSK-003) → services-{locale}.png
 *   - TicketScreen (KIOSK-005)   → ticket-{locale}.png
 *
 * Résolution kiosk : 1024×768, animations désactivées (reduced-motion).
 * maxDiffPixelRatio : 0.002 (voir playwright.config.ts).
 *
 * Gate : local / RT-003 uniquement (Chromium requis).
 * Script : `pnpm test:visual` — EXCLU du script `test` standard.
 */
import { test, expect } from "@playwright/test";

const LOCALES = ["fr", "en"] as const;

/**
 * Paramètres ticket par défaut — KIOSK-005
 */
const TICKET_PARAMS = new URLSearchParams({
  displayNumber: "A007",
  position: "4",
  estimatedWaitMinutes: "12",
});

/**
 * Attend que le réseau soit inactif et que les animations
 * CSS soient terminées (ou désactivées via reduced-motion).
 */
async function waitForStable(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  // Laisse React finir le rendu
  await page.waitForTimeout(500);
}

// ─── HomeScreen (KIOSK-002) ───────────────────────────────────────────────────

test.describe("KIOSK-002: HomeScreen — régression visuelle ×4 langues", () => {
  for (const locale of LOCALES) {
    test(`home-${locale}`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await waitForStable(page);

      // Vérifier que la page est chargée (titre présent)
      const main = page.locator("main[role='main']");
      await expect(main).toBeVisible();

      await expect(page).toHaveScreenshot(`home-${locale}.png`, {
        fullPage: false,
        clip: { x: 0, y: 0, width: 1024, height: 768 },
      });
    });
  }
});

// ─── ServicesScreen (KIOSK-003) ───────────────────────────────────────────────

test.describe("KIOSK-003: ServicesScreen — régression visuelle ×4 langues", () => {
  for (const locale of LOCALES) {
    test(`services-${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/services`);
      await waitForStable(page);

      const main = page.locator("main[role='main']");
      await expect(main).toBeVisible();

      await expect(page).toHaveScreenshot(`services-${locale}.png`, {
        fullPage: false,
        clip: { x: 0, y: 0, width: 1024, height: 768 },
      });
    });
  }
});

// ─── TicketScreen (KIOSK-005) ─────────────────────────────────────────────────

test.describe("KIOSK-005: TicketScreen — régression visuelle ×4 langues", () => {
  for (const locale of LOCALES) {
    test(`ticket-${locale}`, async ({ page }) => {
      // Bloquer speechSynthesis pour éviter le bruit audio/timing
      await page.addInitScript(() => {
        Object.defineProperty(window, "speechSynthesis", {
          value: {
            speak: () => {},
            cancel: () => {},
            pause: () => {},
            resume: () => {},
            getVoices: () => [],
            speaking: false,
            pending: false,
            paused: false,
            onvoiceschanged: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          },
          writable: false,
          configurable: true,
        });
        // Stub SpeechSynthesisUtterance
        (window as unknown as Record<string, unknown>)["SpeechSynthesisUtterance"] = class {
          constructor(public text: string) {}
          lang = "";
        };
      });

      await page.goto(`/${locale}/ticket?${TICKET_PARAMS.toString()}`);
      await waitForStable(page);

      // Vérifier le numéro de ticket
      const ticketNumber = page.locator("[data-testid='ticket-number']");
      await expect(ticketNumber).toBeVisible();
      await expect(ticketNumber).toHaveText("A007");

      await expect(page).toHaveScreenshot(`ticket-${locale}.png`, {
        fullPage: false,
        clip: { x: 0, y: 0, width: 1024, height: 768 },
      });
    });
  }
});
